"""NLI-constrained abductive enthymeme scorer & circularity detector.

Implements Hypothesis H1 from the Argument Atlas research specification:

    S(E | P, C) = Delta_NLI(E | P, C)
                  - lambda_usurp * P_NLI(C | E)
                  - lambda_triv  * TrivialConditionalPenalty(E, P, C)

where:
1. `Delta_NLI = P_NLI(C | P union {E}) - P_NLI(C | P)` measures whether adding the candidate
   implicit premise E genuinely closes the deductive/evidential gap to conclusion C.
2. `P_NLI(C | E)` penalizes **conclusion usurpation** (candidates that restate or entail C
   alone without needing the explicit premises P).
3. `TrivialConditionalPenalty` combines semantic cosine similarity to the synthetic material
   conditional "If P1 and ..., then C" with a low-novel-content filter, penalizing lazy
   tautological rewrites ("If P, then C") that contribute no conceptual bridge.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Optional

import torch
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from transformers import AutoModelForSequenceClassification, AutoTokenizer

_STOP_AND_CONNECTIVES = {
    "a", "an", "and", "are", "as", "at", "be", "because", "been", "being", "but", "by",
    "can", "could", "do", "does", "did", "else", "for", "from", "had", "has", "have",
    "he", "hence", "her", "here", "his", "if", "implies", "imply", "in", "into", "is",
    "it", "its", "may", "might", "must", "no", "nor", "not", "of", "on", "only", "or",
    "our", "shall", "she", "should", "since", "so", "such", "than", "that", "the",
    "their", "them", "then", "there", "therefore", "these", "they", "this", "those",
    "though", "thus", "to", "was", "we", "were", "what", "whatever", "when", "where",
    "which", "while", "who", "will", "with", "would", "you", "your",
}


def _content_tokens(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z]{2,}", text.lower())
    return {w for w in words if w not in _STOP_AND_CONNECTIVES}


def _select_device(preferred: Optional[str] = None) -> str:
    if preferred:
        return preferred
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class EnthymemeScoreBreakdown(BaseModel):
    candidate: str
    p_entail_base: float
    p_entail_with_e: float
    delta_nli: float
    p_contradict_with_e: float
    usurpation_nli: float
    reverse_entail_nli: float
    conclusion_sim: float
    usurpation_score: float
    material_conditional_sim: float
    novel_content_ratio: float
    triviality_penalty: float
    final_score: float
    verdict: str


@dataclass
class ScorerConfig:
    nli_model_id: str = "MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
    embed_model_id: str = "BAAI/bge-small-en-v1.5"
    lambda_usurp: float = 0.65
    lambda_triv: float = 0.75
    device: Optional[str] = None


class AbductiveNLIScorer:
    """Scores candidate implicit premises (*enthymemes*) for sufficiency and non-circularity."""

    def __init__(self, config: Optional[ScorerConfig] = None) -> None:
        self.config = config or ScorerConfig()
        self.device = _select_device(self.config.device)

        self.tokenizer = AutoTokenizer.from_pretrained(self.config.nli_model_id)
        self.nli_model = AutoModelForSequenceClassification.from_pretrained(
            self.config.nli_model_id
        )
        self.nli_model.eval()
        self.nli_model.to(self.device)

        # Read label indices dynamically from model config rather than hardcoding 0/1/2.
        id2label = {int(k): str(v).lower() for k, v in self.nli_model.config.id2label.items()}
        self.entail_idx = next(i for i, lbl in id2label.items() if "entail" in lbl)
        self.neutral_idx = next(i for i, lbl in id2label.items() if "neutral" in lbl)
        self.contradict_idx = next(i for i, lbl in id2label.items() if "contradict" in lbl)

        self.embedder = SentenceTransformer(self.config.embed_model_id, device=self.device)

    @torch.inference_mode()
    def nli_probs_batch(self, pairs: list[tuple[str, str]]) -> list[dict[str, float]]:
        premises = [p for p, _ in pairs]
        hypotheses = [h for _, h in pairs]
        enc = self.tokenizer(
            premises,
            hypotheses,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        ).to(self.device)
        logits = self.nli_model(**enc).logits
        probs = torch.softmax(logits, dim=-1).detach().cpu().tolist()
        return [
            {
                "entailment": float(row[self.entail_idx]),
                "neutral": float(row[self.neutral_idx]),
                "contradiction": float(row[self.contradict_idx]),
            }
            for row in probs
        ]

    @torch.inference_mode()
    def cosine_similarities(self, anchor: str, candidates: list[str]) -> list[float]:
        texts = [anchor] + candidates
        embs = self.embedder.encode(
            texts, normalize_embeddings=True, convert_to_tensor=True
        )
        anchor_vec = embs[0]
        cand_vecs = embs[1:]
        sims = torch.matmul(cand_vecs, anchor_vec).detach().cpu().tolist()
        return [float(s) for s in sims]

    def rank_candidates(
        self,
        explicit_premises: list[str],
        conclusion: str,
        candidates: list[str],
    ) -> list[EnthymemeScoreBreakdown]:
        if not candidates:
            return []

        clean_premises = [p.strip().rstrip(".") for p in explicit_premises if p.strip()]
        base_premise_text = ". ".join(clean_premises) + ("." if clean_premises else "")
        synthetic_conditional = (
            f"If {' and '.join(clean_premises)}, then {conclusion.strip().rstrip('.')}."
        )

        # Batch all NLI calls:
        # [0]          = (base, C)
        # [1..N]       = (base + E_i, C)
        # [N+1..2N]    = (E_i, C)   -> forward usurpation: does E entail C alone?
        # [2N+1..3N]   = (C, E_i)   -> reverse circularity: is E already entailed by C?
        n = len(candidates)
        nli_pairs: list[tuple[str, str]] = [(base_premise_text, conclusion)]
        for cand in candidates:
            cand_clean = cand.strip().rstrip(".") + "."
            nli_pairs.append((f"{base_premise_text} {cand_clean}".strip(), conclusion))
        for cand in candidates:
            nli_pairs.append((cand.strip(), conclusion))
        for cand in candidates:
            nli_pairs.append((conclusion, cand.strip()))

        nli_results = self.nli_probs_batch(nli_pairs)
        p_entail_base = nli_results[0]["entailment"]
        with_e_results = nli_results[1 : 1 + n]
        alone_results = nli_results[1 + n : 1 + 2 * n]
        reverse_results = nli_results[1 + 2 * n :]

        # Semantic similarity against:
        # (a) synthetic material conditional "If P, then C" (triviality signal)
        # (b) conclusion C directly (paraphrase usurpation signal)
        cond_sims = self.cosine_similarities(synthetic_conditional, candidates)
        concl_sims = self.cosine_similarities(conclusion, candidates)

        # Reference content tokens of explicit premises + conclusion.
        ref_tokens = _content_tokens(base_premise_text + " " + conclusion)

        breakdowns: list[EnthymemeScoreBreakdown] = []
        for idx, cand in enumerate(candidates):
            p_entail_with_e = with_e_results[idx]["entailment"]
            p_contra_with_e = with_e_results[idx]["contradiction"]
            delta_nli = p_entail_with_e - p_entail_base
            usurp_nli = alone_results[idx]["entailment"]
            reverse_nli = reverse_results[idx]["entailment"]
            concl_sim = concl_sims[idx]
            cond_sim = cond_sims[idx]

            # Bidirectional circularity:
            # - Forward usurpation: E entails C alone (P(C | E))
            # - Reverse paraphrase circularity: C entails E (P(E | C) >= 0.93) AND E stays in
            #   C's local semantic neighborhood (concl_sim >= 0.86), preventing false positives
            #   from pretrained NLI models over-generalizing a concrete conclusion into a
            #   universal law (e.g. "I am thinking/existing" -> "Whatever thinks exists").
            concl_paraphrase_penalty = max(0.0, concl_sim - 0.80) / 0.20
            reverse_paraphrase = reverse_nli if (reverse_nli >= 0.93 and concl_sim >= 0.86) else 0.0
            usurpation = max(usurp_nli, reverse_paraphrase, concl_paraphrase_penalty)

            cand_tokens = _content_tokens(cand)
            if cand_tokens:
                novel = cand_tokens - ref_tokens
                novel_ratio = len(novel) / len(cand_tokens)
            else:
                novel_ratio = 0.0

            # Triviality increases when E closely mirrors "If P, then C" (above 0.80 cosine)
            # AND introduces little or no conceptual vocabulary beyond P and C.
            sim_excess = max(0.0, cond_sim - 0.80) / 0.20
            triviality_penalty = sim_excess * (1.0 - 0.65 * novel_ratio)

            final_score = (
                delta_nli
                - self.config.lambda_usurp * usurpation
                - self.config.lambda_triv * triviality_penalty
                - 0.50 * p_contra_with_e
            )

            verdict = _classify_verdict(
                delta_nli=delta_nli,
                usurpation=usurpation,
                triviality_penalty=triviality_penalty,
                novel_ratio=novel_ratio,
                p_contra=p_contra_with_e,
            )

            breakdowns.append(
                EnthymemeScoreBreakdown(
                    candidate=cand,
                    p_entail_base=round(p_entail_base, 4),
                    p_entail_with_e=round(p_entail_with_e, 4),
                    delta_nli=round(delta_nli, 4),
                    p_contradict_with_e=round(p_contra_with_e, 4),
                    usurpation_nli=round(usurp_nli, 4),
                    reverse_entail_nli=round(reverse_nli, 4),
                    conclusion_sim=round(concl_sim, 4),
                    usurpation_score=round(usurpation, 4),
                    material_conditional_sim=round(cond_sim, 4),
                    novel_content_ratio=round(novel_ratio, 4),
                    triviality_penalty=round(triviality_penalty, 4),
                    final_score=round(final_score, 4),
                    verdict=verdict,
                )
            )

        breakdowns.sort(key=lambda b: b.final_score, reverse=True)
        return breakdowns


def _classify_verdict(
    delta_nli: float,
    usurpation: float,
    triviality_penalty: float,
    novel_ratio: float,
    p_contra: float,
) -> str:
    if p_contra >= 0.40:
        return "contradicts_conclusion"
    if triviality_penalty >= 0.30 and novel_ratio <= 0.30:
        return "trivial_tautology"
    if usurpation >= 0.55:
        return "usurpation_circular"
    if triviality_penalty >= 0.30:
        return "trivial_tautology"
    if delta_nli >= 0.15:
        return "valid_bridge"
    if math.isclose(delta_nli, 0.0, abs_tol=0.05):
        return "non_bridging"
    return "weak_bridge"
