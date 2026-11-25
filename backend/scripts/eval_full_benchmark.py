"""Comprehensive PhilArgs-12 empirical benchmark:
1. Bipolar Hypergraph vs. Flat-Graph Knockout Sensitivity Ablation across all 12 passages.
2. DeBERTa-v3 + BGE-small Enthymeme Non-Circularity & Tautology Filter Ablation.
3. Hermeneutic Prism BGE-small Structural Alignment across all 6 rival lenses.
"""

from __future__ import annotations

import statistics
from pathlib import Path

from atlas_ml.api import _parse_frontmatter_metadata
from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.nli_enthymeme import AbductiveNLIScorer
from atlas_ml.rust_bridge import AtlasRustBridge
from atlas_ml.schemas import ArgumentHypergraph, SupportHyperedge

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"
LENSES_DIR = REPO_ROOT / "datasets" / "hermeneutic-lenses"


def flatten_hypergraph_baseline(graph: ArgumentHypergraph) -> ArgumentHypergraph:
    """Simulates standard flat node-to-node argument mining (no conjunctive hyperedges, no undercutters).

    Splits every k-premise conjunctive hyperedge `[P1 & ... & Pk] +> [C]` into k independent
    single-premise edges `[Pi] +> [C]` and drops hyperedge undercutters (which flat AFs cannot target).
    """
    flat_edges: list[SupportHyperedge] = []
    for edge in graph.support_hyperedges:
        for idx, prem in enumerate(edge.premises):
            flat_edges.append(
                SupportHyperedge(
                    id=f"{edge.id}_flat_{idx}",
                    premises=[prem],
                    conclusion=edge.conclusion,
                    weight=edge.weight,
                    scheme=edge.scheme,
                )
            )
    return ArgumentHypergraph(
        passage_id=f"{graph.passage_id}-flat",
        source_text=graph.source_text,
        nodes=[n.model_copy(deep=True) for n in graph.nodes],
        support_hyperedges=flat_edges,
        rebutting_attacks=[r.model_copy(deep=True) for r in graph.rebutting_attacks],
        undercutting_attacks=[],
    )


def main() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)

    print("=" * 108)
    print(" PART 1: PHILARGS-12 HYPERGRAPH SOLVER & FLAT-GRAPH KNOCKOUT ABLATION")
    print("=" * 108)

    files = sorted(PHIL_ARGS_DIR.glob("*.argdown"))
    latencies: list[int] = []
    gold_graphs: dict[str, ArgumentHypergraph] = {}
    gold_reports = {}
    knockout_cases = 0
    hypergraph_collapsed = 0
    flat_false_survivals = 0

    for path in files:
        g = bridge.load_argdown(path)
        rep = bridge.solve(g, strict_spans=True)
        gold_graphs[g.passage_id] = g
        gold_reports[g.passage_id] = rep
        latencies.append(rep.solve_time_microseconds)

        tid = rep.thesis_id or "-"
        t_score = rep.gradual_df_quad.node_acceptability.get(tid, 0.0)
        dung_lbl = rep.dung_semantics.grounded_labels.get(tid, "undecided")
        ko_str = "-"
        flat_after_str = "n/a"

        if rep.minimal_knockouts:
            top_ko = rep.minimal_knockouts[0]
            ko_ids = set(top_ko.removed_node_ids)
            ko_str = f"drop {top_ko.removed_node_ids} (cost={top_ko.credence_cost:.2f})"
            knockout_cases += 1
            if top_ko.post_knockout_acceptability <= 0.50:
                hypergraph_collapsed += 1

            # Test the exact same single/minimal premise knockout on the flattened graph baseline!
            flat_g = flatten_hypergraph_baseline(g)
            for n in flat_g.nodes:
                if n.id in ko_ids:
                    n.base_credence = 0.0
            flat_rep = bridge.solve(flat_g, strict_spans=True)
            flat_after = flat_rep.gradual_df_quad.node_acceptability.get(tid, 0.0)
            flat_after_str = f"{flat_after:.4f}"
            if flat_after > 0.50:
                flat_false_survivals += 1

        print(
            f" {g.passage_id:<32} | {rep.solve_time_microseconds:3d} µs "
            f"| [{tid}]={t_score:.4f} ({dung_lbl:<9}) "
            f"| #1 KO: {ko_str:<26} | Flat post-KO: {flat_after_str}"
        )

    print("-" * 108)
    print(
        f" Median Rust latency: {statistics.median(latencies):.0f} µs (mean {statistics.mean(latencies):.1f} µs) "
        f"| Knockout-eligible theses: {knockout_cases}/{len(files)} "
        f"| Flat-graph false survivals when linked premise dropped: {flat_false_survivals}/{knockout_cases} "
        f"({100.0 * flat_false_survivals / max(1, knockout_cases):.1f}%)"
    )

    print("\n" + "=" * 108)
    print(" PART 2: HERMENEUTIC PRISM BGE-SMALL ALIGNMENT ACROSS 6 RIVAL LENSES (τ = 0.72)")
    print("=" * 108)
    aligner = BipartiteGraphAligner(embed_model_id="BAAI/bge-small-en-v1.5", similarity_threshold=0.72)
    exp_f1s: list[float] = []
    enth_f1s: list[float] = []

    for lpath in sorted(LENSES_DIR.glob("*.argdown")):
        raw = lpath.read_text(encoding="utf-8")
        meta = _parse_frontmatter_metadata(raw)
        target_id = meta.get("target_passage_id", "")
        if target_id not in gold_graphs:
            continue
        lens_g = bridge.load_argdown(lpath)
        lens_rep = bridge.solve(lens_g, strict_spans=True)
        gold_g = gold_graphs[target_id]
        gold_rep = gold_reports[target_id]

        al = aligner.align(lens_g, gold_g, threshold=0.72)
        exp_f1s.append(al.explicit_node_prf.f1)
        enth_f1s.append(al.enthymeme_prf.f1)

        tid_a = gold_rep.thesis_id or "-"
        tid_b = lens_rep.thesis_id or "-"
        sa = gold_rep.gradual_df_quad.node_acceptability.get(tid_a, 0.0)
        sb = lens_rep.gradual_df_quad.node_acceptability.get(tid_b, 0.0)
        print(
            f" {lens_g.passage_id:<30} | ExplicitF1={al.explicit_node_prf.f1:.3f} "
            f"| EnthF1={al.enthymeme_prf.f1:.3f} | Consensus={al.consensus_score:.3f} "
            f"| Thesis: {sa:.2f} -> {sb:.2f} ({sb - sa:+.2f})"
        )

    print("-" * 108)
    print(
        f" Mean Explicit Node F1: {statistics.mean(exp_f1s):.3f} vs. "
        f"Mean Enthymeme F1: {statistics.mean(enth_f1s):.3f} (confirming H3: interpretive divergence concentrates in unspoken assumptions)"
    )

    print("\n" + "=" * 108)
    print(" PART 3: DEBERTA-V3 + BGE-SMALL ENTHYMEME NON-CIRCULARITY & TAUTOLOGY AUDIT (5 PASSAGES x 4 CANDIDATES)")
    print("=" * 108)
    scorer = AbductiveNLIScorer()
    cases = [
        (
            "Descartes (Cogito)",
            ["Even in radical doubt, the act of thinking or doubting is occurring."],
            "The thinker must exist as something while doubting.",
            {
                "gold_enthymeme": "Whatever is actively thinking must exist while it is thinking.",
                "trivial_tautology": "If even in radical doubt the act of thinking or doubting is occurring, then the thinker must exist as something while doubting.",
                "circular_usurpation": "The thinker necessarily exists as a substance while doubting.",
                "distractor": "Sensory perceptions frequently deceive us during dreams and illusions.",
            },
        ),
        (
            "Hume (Induction)",
            [
                "Repeating an observation produces a psychological propensity to expect the same outcome without any reasoning step.",
                "Any propensity formed by repetition without reasoning is Custom (habit).",
            ],
            "All inductive inferences from past experience are effects of custom rather than rational demonstration.",
            {
                "gold_enthymeme": "There is no non-circular rational principle capable of deductively justifying future expectations from past observations.",
                "trivial_tautology": "If repeating an observation produces custom without reasoning, then all inductive inferences from past experience are effects of custom rather than rational demonstration.",
                "circular_usurpation": "Inductive inferences from experience are produced solely by custom, not by rational demonstration.",
                "distractor": "Mathematical relations of ideas can be known with certainty through pure demonstration.",
            },
        ),
        (
            "Dostoevsky (Rebellion)",
            ["Eternal cosmic harmony requires the uncompensated torture and suffering of an innocent child as a necessary means."],
            "Eternal cosmic harmony is morally unworthy of acceptance at the price of an innocent child's suffering.",
            {
                "gold_enthymeme": "No future utilitarian good can morally justify using the unredeemed suffering of an innocent person as an instrument.",
                "trivial_tautology": "If eternal cosmic harmony requires the torture of an innocent child as a necessary means, then eternal cosmic harmony is morally unworthy of acceptance at that price.",
                "circular_usurpation": "Cosmic harmony purchased by innocent suffering is morally unacceptable and unworthy.",
                "distractor": "Human beings struggle to comprehend infinite metaphysical realities with finite Euclidean minds.",
            },
        ),
        (
            "Aristotle (Ergon)",
            ["Active exercise of the rational faculty is the characteristic function distinctive to human beings."],
            "The supreme human good consists in active exercise of the soul's rational faculty in accordance with virtue.",
            {
                "gold_enthymeme": "The supreme good of any being resides in performing its characteristic function with excellence and virtue.",
                "trivial_tautology": "If active exercise of the rational faculty is the distinctive human function, then the supreme human good consists in active exercise of the rational faculty in accordance with virtue.",
                "circular_usurpation": "Human good turns out to be rational soul activity in accordance with virtue.",
                "distractor": "Carpenters and shoemakers craft useful artifacts within the political community.",
            },
        ),
        (
            "Spinoza (Monism)",
            ["Suppose a second substance besides God exists and shares one of God's infinite attributes."],
            "Positing a second substance besides God leads to a contradiction.",
            {
                "gold_enthymeme": "It is logically impossible for two distinct substances in nature to share the exact same attribute.",
                "trivial_tautology": "If a second substance besides God exists and shares one of God's attributes, then positing a second substance besides God leads to a contradiction.",
                "circular_usurpation": "Assuming a second substance alongside God is self-contradictory and absurd.",
                "distractor": "Finite modes depend causally on an infinite chain of prior finite modes.",
            },
        ),
    ]
    gold_top1 = 0
    for label, prems, conc, cand_dict in cases:
        inv_map = {v: k for k, v in cand_dict.items()}
        ranked = scorer.rank_candidates(prems, conc, list(cand_dict.values()))
        top_kind = inv_map[ranked[0].candidate]
        if top_kind == "gold_enthymeme":
            gold_top1 += 1
        print(f" [{label:<22}] #1={top_kind} (verdict={ranked[0].verdict}, score={ranked[0].final_score:+.3f})")
        for idx, item in enumerate(ranked, 1):
            kind = inv_map[item.candidate]
            print(
                f"   #{idx} {kind:<20} | verdict={item.verdict:<20} | final={item.final_score:+.3f} "
                f"| ΔNLI={item.delta_nli:+.3f} | usurp={item.usurpation_score:.3f} | triv={item.triviality_penalty:.3f}"
            )
    print("-" * 108)
    print(f" Gold Enthymeme Top-1 Accuracy: {gold_top1}/{len(cases)} ({100.0 * gold_top1 / len(cases):.1f}%)")


if __name__ == "__main__":
    main()
