"""Empirical ablation script for Hypothesis H1 (Abductive-NLI Enthymeme Scoring).

Evaluates `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` + `BAAI/bge-small-en-v1.5`
across classical philosophical arguments (Descartes, Hume, Dostoevsky), testing whether
the non-circularity and trivial-conditional penalties separate genuine enthymemes from:
  1. Valid philosophical enthymemes (expected top rank)
  2. Trivial material conditionals ("If P, then C")
  3. Conclusion usurpations (restating C directly)
  4. Topically related non-bridging distractors
"""

from __future__ import annotations

import json
import time

from atlas_ml.nli_enthymeme import AbductiveNLIScorer, ScorerConfig

ABLATION_CASES = [
    {
        "passage_id": "descartes-discourse-cogito",
        "explicit_premises": [
            "Even in radical doubt, the act of thinking or doubting is occurring."
        ],
        "conclusion": "The thinker must exist as something while doubting.",
        "candidates": {
            "gold_enthymeme": "Whatever is actively thinking must exist while it is thinking.",
            "trivial_conditional": "If even in radical doubt the act of thinking or doubting is occurring, then the thinker must exist as something while doubting.",
            "usurpation": "The thinker necessarily exists as a substance while doubting.",
            "distractor": "Sensory perceptions frequently deceive us during dreams and illusions.",
        },
    },
    {
        "passage_id": "hume-problem-of-induction",
        "explicit_premises": [
            "Repeating an observation produces a psychological propensity to expect the same outcome without any reasoning step.",
            "Any propensity formed by repetition without reasoning is Custom (habit).",
        ],
        "conclusion": "All inductive inferences from past experience are effects of custom rather than rational demonstration.",
        "candidates": {
            "gold_enthymeme": "There is no non-circular rational principle capable of deductively justifying future expectations from past observations.",
            "trivial_conditional": "If repeating an observation produces custom without reasoning, then all inductive inferences from past experience are effects of custom rather than rational demonstration.",
            "usurpation": "Inductive inferences from experience are produced solely by custom, not by rational demonstration.",
            "distractor": "Mathematical relations of ideas can be known with certainty through pure demonstration.",
        },
    },
    {
        "passage_id": "dostoevsky-ivan-rebellion",
        "explicit_premises": [
            "Eternal cosmic harmony requires the uncompensated torture and suffering of an innocent child as a necessary means."
        ],
        "conclusion": "Eternal cosmic harmony is morally unworthy of acceptance at the price of an innocent child's suffering.",
        "candidates": {
            "gold_enthymeme": "No future utilitarian good can morally justify using the unredeemed suffering of an innocent person as an instrument.",
            "trivial_conditional": "If eternal cosmic harmony requires the torture of an innocent child as a necessary means, then eternal cosmic harmony is morally unworthy of acceptance at that price.",
            "usurpation": "Cosmic harmony purchased by innocent suffering is morally unacceptable and unworthy.",
            "distractor": "Human beings struggle to comprehend infinite metaphysical realities with finite Euclidean minds.",
        },
    },
]


def main() -> None:
    t0 = time.perf_counter()
    print("Loading DeBERTa-v3 NLI & BGE-small embedder...")
    scorer = AbductiveNLIScorer(ScorerConfig())
    print(f"Loaded on device='{scorer.device}' in {time.perf_counter() - t0:.2f}s\n")

    summary_rows = []
    for case in ABLATION_CASES:
        print("=" * 92)
        print(f"PASSAGE: {case['passage_id']}")
        print(f"Premises  : {case['explicit_premises']}")
        print(f"Conclusion: {case['conclusion']}")
        print("-" * 92)

        cand_map = case["candidates"]
        label_by_text = {v: k for k, v in cand_map.items()}
        ranked = scorer.rank_candidates(
            explicit_premises=case["explicit_premises"],
            conclusion=case["conclusion"],
            candidates=list(cand_map.values()),
        )

        for rank, item in enumerate(ranked, start=1):
            kind = label_by_text[item.candidate]
            print(
                f"#{rank} [{kind:<20}] score={item.final_score:+.4f} "
                f"(base={item.p_entail_base:.3f} -> withE={item.p_entail_with_e:.3f}, "
                f"ΔNLI={item.delta_nli:+.3f}, usurpNLI={item.usurpation_nli:.3f}, "
                f"revNLI={item.reverse_entail_nli:.3f}, conclSim={item.conclusion_sim:.3f}, "
                f"condSim={item.material_conditional_sim:.3f}, novel={item.novel_content_ratio:.2f}, "
                f"trivPen={item.triviality_penalty:.3f}) | {item.verdict}"
            )
            print(f"    \"{item.candidate}\"")

        top_kind = label_by_text[ranked[0].candidate]
        verdicts = {label_by_text[r.candidate]: r.verdict for r in ranked}
        expected_verdicts_ok = (
            verdicts["gold_enthymeme"] == "valid_bridge"
            and verdicts["trivial_conditional"] == "trivial_tautology"
            and verdicts["usurpation"] == "usurpation_circular"
            and verdicts["distractor"] in {"non_bridging", "weak_bridge"}
        )
        summary_rows.append(
            {
                "passage_id": case["passage_id"],
                "top_ranked": top_kind,
                "gold_won": top_kind == "gold_enthymeme",
                "verdicts_exact": expected_verdicts_ok,
                "results": [
                    {"kind": label_by_text[r.candidate], **r.model_dump()}
                    for r in ranked
                ],
            }
        )
        print()

    gold_wins = sum(1 for row in summary_rows if row["gold_won"])
    verdict_wins = sum(1 for row in summary_rows if row["verdicts_exact"])
    print("=" * 92)
    print(
        f"SUMMARY: Gold enthymeme ranked #1 in {gold_wins}/{len(summary_rows)} cases; "
        f"all 4-class verdicts exact in {verdict_wins}/{len(summary_rows)} cases."
    )
    print(
        json.dumps(
            {
                "gold_top1": gold_wins,
                "verdicts_exact": verdict_wins,
                "total": len(summary_rows),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
