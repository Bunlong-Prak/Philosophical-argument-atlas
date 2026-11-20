"""End-to-end neuro-symbolic extraction pipeline: LLM -> Span Grounder -> NLI Audit -> Rust Solver."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Optional, Protocol

import httpx
from pydantic import BaseModel, Field

from .nli_enthymeme import AbductiveNLIScorer, EnthymemeScoreBreakdown
from .rust_bridge import AtlasRustBridge, SolverReport
from .schemas import (
    ArgumentHypergraph,
    DeterministicSpanGrounder,
    NodeType,
    PropositionNode,
    RebuttingAttack,
    SpanGroundingError,
    SupportHyperedge,
    TextSpan,
    UndercuttingAttack,
)

ProviderName = Literal["groq", "openai", "ollama", "anthropic"]

_DEFAULT_MODELS: dict[ProviderName, str] = {
    "groq": "llama-3.3-70b-versatile",
    "openai": "gpt-4o-mini",
    "ollama": "llama3.2",
    "anthropic": "claude-3-5-sonnet-latest",
}

_DEFAULT_BASE_URLS: dict[ProviderName, str] = {
    "groq": "https://api.groq.com/openai/v1",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434/v1",
    "anthropic": "https://api.anthropic.com/v1",
}

_ENV_KEY_BY_PROVIDER: dict[ProviderName, Optional[str]] = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "ollama": None,
}

_SYSTEM_PROMPT = """You extract philosophical arguments into a Bipolar Argumentation Hypergraph (JSON).

Return ONLY valid JSON with keys:
- "nodes": list of {
    "id": string (e.g. "P1", "E1", "C", "U1"),
    "proposition": concise normalized claim string,
    "node_type": one of ["thesis", "explicit_premise", "enthymeme", "objection", "counterfactual_assumption"],
    "quote": verbatim substring from source_text (required for all types EXCEPT "enthymeme"; omit or null for "enthymeme"),
    "speaker": optional string,
    "base_credence": float in [0.0, 1.0]. Set 0.0 for derived claims that receive incoming support hyperedges; set 0.70..0.95 for root premises, enthymemes, and objections.
  }
- "support_hyperedges": list of {
    "id": string (e.g. "H1"),
    "premises": non-empty list of linked premise node IDs that must hold together,
    "conclusion": target node ID,
    "weight": float in [0.0, 1.0],
    "scheme": optional string (e.g. "modus_ponens", "modus_tollens", "reductio_ad_absurdum", "disjunctive_syllogism", "practical_reasoning")
  }
- "rebutting_attacks": list of {"id": string, "attacker": node ID, "target": node ID, "weight": float}
- "undercutting_attacks": list of {"id": string, "attacker": node ID, "target_hyperedge": hyperedge ID, "weight": float}

Rules:
1. Every non-enthymeme node MUST copy an exact verbatim substring from source_text into "quote".
2. Model hidden assumptions as "enthymeme" nodes inside the linked "premises" list of a support hyperedge, never as trivial "If P then C" restatements.
3. Distinguish direct rebuttals (attacking a claim node) from Pollock undercutters (attacking a support_hyperedge ID).
"""


class LLMConfigurationError(RuntimeError):
    """Raised when a cloud LLM provider lacks credentials."""


class LLMExtractionError(RuntimeError):
    """Raised when LLM output cannot be parsed into valid JSON."""


class LLMClient(Protocol):
    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]: ...


@dataclass
class LLMConfig:
    provider: ProviderName = "groq"
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    temperature: float = 0.1
    timeout_seconds: float = 60.0

    def resolved_model(self) -> str:
        return self.model or _DEFAULT_MODELS[self.provider]

    def resolved_base_url(self) -> str:
        return (self.base_url or _DEFAULT_BASE_URLS[self.provider]).rstrip("/")

    def resolved_api_key(self) -> Optional[str]:
        if self.api_key:
            return self.api_key
        env_name = _ENV_KEY_BY_PROVIDER[self.provider]
        return os.getenv(env_name) if env_name else None


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if fence_match:
        return fence_match.group(1).strip()
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        return text[first : last + 1]
    return text


class HttpLLMClient:
    """Lightweight HTTP client for Groq, OpenAI, Ollama, and Anthropic JSON extraction."""

    def __init__(self, config: LLMConfig) -> None:
        self.config = config

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        api_key = self.config.resolved_api_key()
        if self.config.provider != "ollama" and not api_key:
            env_var = _ENV_KEY_BY_PROVIDER[self.config.provider]
            raise LLMConfigurationError(
                f"Provider '{self.config.provider}' requires an API key (set {env_var} or pass api_key)."
            )

        base_url = self.config.resolved_base_url()
        model = self.config.resolved_model()

        if self.config.provider == "anthropic":
            headers = {
                "x-api-key": api_key or "",
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            payload = {
                "model": model,
                "max_tokens": 2048,
                "temperature": self.config.temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }
            resp = httpx.post(
                f"{base_url}/messages",
                headers=headers,
                json=payload,
                timeout=self.config.timeout_seconds,
            )
            resp.raise_for_status()
            data = resp.json()
            text = "".join(
                blk.get("text", "") for blk in data.get("content", []) if blk.get("type") == "text"
            )
        else:
            headers = {"content-type": "application/json"}
            if api_key:
                headers["authorization"] = f"Bearer {api_key}"
            payload = {
                "model": model,
                "temperature": self.config.temperature,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "response_format": {"type": "json_object"},
            }
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=self.config.timeout_seconds,
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["choices"][0]["message"]["content"]

        cleaned = _strip_json_fences(text)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise LLMExtractionError(f"Model did not return valid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise LLMExtractionError("Expected top-level JSON object from extractor.")
        return parsed


class EnthymemeAuditItem(BaseModel):
    hyperedge_id: str
    enthymeme_node_id: str
    conclusion_id: str
    explicit_premises: list[str]
    breakdown: EnthymemeScoreBreakdown
    flagged_invalid: bool


class PipelineResult(BaseModel):
    hypergraph: ArgumentHypergraph
    solver_report: SolverReport
    enthymeme_audits: list[EnthymemeAuditItem] = Field(default_factory=list)
    dropped_node_ids: list[str] = Field(default_factory=list)
    flagged_enthymeme_ids: list[str] = Field(default_factory=list)


class NLIScorerLike(Protocol):
    def rank_candidates(
        self,
        explicit_premises: list[str],
        conclusion: str,
        candidates: list[str],
    ) -> list[EnthymemeScoreBreakdown]: ...


def _build_grounded_graph(
    passage_id: str,
    source_text: str,
    raw_payload: dict[str, Any],
    drop_ungrounded: bool = True,
) -> tuple[ArgumentHypergraph, list[str]]:
    raw_nodes = raw_payload.get("nodes", [])
    kept_nodes: list[PropositionNode] = []
    kept_ids: set[str] = set()
    dropped_ids: list[str] = []

    for item in raw_nodes:
        node_id = str(item.get("id", "")).strip()
        prop_text = str(item.get("proposition", "")).strip()
        if not node_id or not prop_text:
            continue

        raw_type = str(item.get("node_type", "explicit_premise")).strip()
        try:
            node_type = NodeType(raw_type)
        except ValueError:
            node_type = NodeType.EXPLICIT_PREMISE

        credence = max(0.0, min(1.0, float(item.get("base_credence", 0.85))))
        speaker = item.get("speaker")

        if node_type == NodeType.ENTHYMEME:
            kept_nodes.append(
                PropositionNode(
                    id=node_id,
                    proposition=prop_text,
                    node_type=node_type,
                    span=None,
                    speaker=speaker,
                    base_credence=credence,
                )
            )
            kept_ids.add(node_id)
            continue

        # Extract candidate quote from either top-level `quote` or nested `span.verbatim_quote`.
        span_obj = item.get("span") if isinstance(item.get("span"), dict) else {}
        quote = item.get("quote") or span_obj.get("verbatim_quote") or ""
        hint_start = span_obj.get("start_char")

        try:
            grounded_span: TextSpan = DeterministicSpanGrounder.ground_quote(
                source_text=source_text,
                candidate_quote=str(quote),
                hint_start=int(hint_start) if hint_start is not None else None,
                allow_fuzzy=True,
            )
        except SpanGroundingError:
            if drop_ungrounded:
                dropped_ids.append(node_id)
                continue
            raise

        kept_nodes.append(
            PropositionNode(
                id=node_id,
                proposition=prop_text,
                node_type=node_type,
                span=grounded_span,
                speaker=speaker,
                base_credence=credence,
            )
        )
        kept_ids.add(node_id)

    support_hyperedges: list[SupportHyperedge] = []
    valid_edge_ids: set[str] = set()
    for idx, edge in enumerate(raw_payload.get("support_hyperedges", []), start=1):
        eid = str(edge.get("id") or f"H{idx}")
        conc = str(edge.get("conclusion", "")).strip()
        prems = [str(p).strip() for p in edge.get("premises", []) if str(p).strip() in kept_ids]
        if conc in kept_ids and prems:
            weight = max(0.0, min(1.0, float(edge.get("weight", 0.90))))
            support_hyperedges.append(
                SupportHyperedge(
                    id=eid,
                    premises=prems,
                    conclusion=conc,
                    weight=weight,
                    scheme=edge.get("scheme"),
                )
            )
            valid_edge_ids.add(eid)

    rebutting_attacks: list[RebuttingAttack] = []
    for idx, att in enumerate(raw_payload.get("rebutting_attacks", []), start=1):
        attacker = str(att.get("attacker", "")).strip()
        target = str(att.get("target", "")).strip()
        if attacker in kept_ids and target in kept_ids:
            rebutting_attacks.append(
                RebuttingAttack(
                    id=str(att.get("id") or f"R{idx}"),
                    attacker=attacker,
                    target=target,
                    weight=max(0.0, min(1.0, float(att.get("weight", 0.90)))),
                )
            )

    undercutting_attacks: list[UndercuttingAttack] = []
    for idx, und in enumerate(raw_payload.get("undercutting_attacks", []), start=1):
        attacker = str(und.get("attacker", "")).strip()
        tgt_edge = str(und.get("target_hyperedge", "")).strip()
        if attacker in kept_ids and tgt_edge in valid_edge_ids:
            undercutting_attacks.append(
                UndercuttingAttack(
                    id=str(und.get("id") or f"UND{idx}"),
                    attacker=attacker,
                    target_hyperedge=tgt_edge,
                    weight=max(0.0, min(1.0, float(und.get("weight", 0.90)))),
                )
            )

    graph = ArgumentHypergraph(
        passage_id=passage_id,
        source_text=source_text,
        nodes=kept_nodes,
        support_hyperedges=support_hyperedges,
        rebutting_attacks=rebutting_attacks,
        undercutting_attacks=undercutting_attacks,
    )
    return graph, dropped_ids


class NeuroSymbolicPipeline:
    """Runs LLM extraction, deterministic span grounding, NLI enthymeme audit, and Rust solve."""

    def __init__(
        self,
        llm_client: LLMClient,
        rust_bridge: Optional[AtlasRustBridge] = None,
        nli_scorer: Optional[NLIScorerLike] = None,
    ) -> None:
        self.llm_client = llm_client
        self.rust_bridge = rust_bridge or AtlasRustBridge()
        self.nli_scorer = nli_scorer

    def run(
        self,
        passage_id: str,
        source_text: str,
        verify_enthymemes: bool = True,
        drop_ungrounded: bool = True,
        drop_invalid_enthymemes: bool = False,
    ) -> PipelineResult:
        user_prompt = (
            f"Passage ID: {passage_id}\n\n"
            f"Primary Source Text:\n\"\"\"\n{source_text}\n\"\"\"\n\n"
            "Extract the Bipolar Argumentation Hypergraph JSON now."
        )
        raw_payload = self.llm_client.complete_json(_SYSTEM_PROMPT, user_prompt)
        graph, dropped_node_ids = _build_grounded_graph(
            passage_id=passage_id,
            source_text=source_text,
            raw_payload=raw_payload,
            drop_ungrounded=drop_ungrounded,
        )

        audits: list[EnthymemeAuditItem] = []
        flagged_enthymemes: list[str] = []

        if verify_enthymemes:
            scorer = self.nli_scorer
            if scorer is None:
                scorer = AbductiveNLIScorer()
                self.nli_scorer = scorer

            nodes_by_id = {n.id: n for n in graph.nodes}
            invalid_verdicts = {
                "trivial_tautology",
                "usurpation_circular",
                "contradicts_conclusion",
            }

            for edge in graph.support_hyperedges:
                conc_node = nodes_by_id.get(edge.conclusion)
                if not conc_node:
                    continue
                explicit_texts = [
                    nodes_by_id[p].proposition
                    for p in edge.premises
                    if p in nodes_by_id and nodes_by_id[p].node_type != NodeType.ENTHYMEME
                ]
                enth_nodes = [
                    nodes_by_id[p]
                    for p in edge.premises
                    if p in nodes_by_id and nodes_by_id[p].node_type == NodeType.ENTHYMEME
                ]
                if not explicit_texts or not enth_nodes:
                    continue

                ranked = scorer.rank_candidates(
                    explicit_premises=explicit_texts,
                    conclusion=conc_node.proposition,
                    candidates=[en.proposition for en in enth_nodes],
                )
                by_prop = {b.candidate: b for b in ranked}
                for en in enth_nodes:
                    breakdown = by_prop[en.proposition]
                    is_bad = breakdown.verdict in invalid_verdicts
                    if is_bad:
                        flagged_enthymemes.append(en.id)
                    audits.append(
                        EnthymemeAuditItem(
                            hyperedge_id=edge.id,
                            enthymeme_node_id=en.id,
                            conclusion_id=conc_node.id,
                            explicit_premises=explicit_texts,
                            breakdown=breakdown,
                            flagged_invalid=is_bad,
                        )
                    )

            if drop_invalid_enthymemes and flagged_enthymemes:
                bad_set = set(flagged_enthymemes)
                graph = graph.model_copy(
                    update={
                        "nodes": [n for n in graph.nodes if n.id not in bad_set],
                        "support_hyperedges": [
                            e.model_copy(
                                update={"premises": [p for p in e.premises if p not in bad_set]}
                            )
                            for e in graph.support_hyperedges
                            if any(p not in bad_set for p in e.premises)
                        ],
                    }
                )

        report = self.rust_bridge.solve(graph, strict_spans=True)
        return PipelineResult(
            hypergraph=graph,
            solver_report=report,
            enthymeme_audits=audits,
            dropped_node_ids=dropped_node_ids,
            flagged_enthymeme_ids=flagged_enthymemes,
        )
