"""Live benchmark & BGE semantic graph alignment validation across PhilArgs-6."""

from __future__ import annotations

from pathlib import Path

from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.rust_bridge import AtlasRustBridge
from atlas_ml.schemas import ArgumentHypergraph, NodeType

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"


def main() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    aligner = BipartiteGraphAligner(
        embed_model_id="BAAI/bge-small-en-v1.5",
        similarity_threshold=0.72,
    )

    print("=" * 92)
    print(" PHILARGS-6 CORPUS SOLVER AUDIT (Rust release binary + strict spans)")
    print("=" * 92)
    files = sorted(PHIL_ARGS_DIR.glob("*.argdown"))
    loaded_graphs: dict[str, ArgumentHypergraph] = {}

    for path in files:
        g = bridge.load_argdown(path)
        loaded_graphs[g.passage_id] = g
        rep = bridge.solve(g, strict_spans=True)
        tid = rep.thesis_id or "-"
        t_score = rep.gradual_df_quad.node_acceptability.get(tid, 0.0)
        print(
            f" {g.passage_id:<34} | nodes={len(g.nodes):2d} "
            f"sup={len(g.support_hyperedges)} reb={len(g.rebutting_attacks)} und={len(g.undercutting_attacks)} "
            f"| {rep.solve_time_microseconds:3d} µs | [{tid}]={t_score:.4f} ({rep.dung_semantics.grounded_labels.get(tid)})"
        )

    # Demonstrate Hermeneutic Prism alignment using paraphrased Plato reconstruction vs Gold.
    gold_plato = loaded_graphs["plato-euthyphro-dilemma"]
    paraphrased_nodes = [
        n.model_copy(
            update={
                "id": f"alt_{n.id}",
                "proposition": {
                    "P1": "Socrates notes Euthyphro's claim that piety equals whatever the gods love.",
                    "E1": "Divine approval is what causes an act to be holy.",
                    "C": "An action is pious simply because it is beloved by the gods.",
                    "P2": "The gods love what is holy precisely because it already possesses holiness.",
                    "P3": "Being dear to the gods is an effect of their loving it.",
                    "E2": "Two concepts with inverse explanatory order cannot be identical.",
                    "U1": "Being loved by the gods is only an accidental feature, not the essence of piety.",
                }[n.id],
            }
        )
        for n in gold_plato.nodes
    ]
    alt_plato = ArgumentHypergraph(
        passage_id="plato-alt-lens",
        nodes=paraphrased_nodes,
        support_hyperedges=[
            e.model_copy(
                update={
                    "id": f"alt_{e.id}",
                    "premises": [f"alt_{p}" for p in e.premises],
                    "conclusion": f"alt_{e.conclusion}",
                }
            )
            for e in gold_plato.support_hyperedges
        ],
        rebutting_attacks=[
            r.model_copy(
                update={
                    "id": f"alt_{r.id}",
                    "attacker": f"alt_{r.attacker}",
                    "target": f"alt_{r.target}",
                }
            )
            for r in gold_plato.rebutting_attacks
        ],
        undercutting_attacks=[
            u.model_copy(
                update={
                    "id": f"alt_{u.id}",
                    "attacker": f"alt_{u.attacker}",
                    "target_hyperedge": f"alt_{u.target_hyperedge}",
                }
            )
            for u in gold_plato.undercutting_attacks
        ],
    )

    print("\n" + "=" * 92)
    print(" LIVE BGE-SMALL HERMENEUTIC ALIGNMENT (Paraphrased Euthyphro Lens vs. Gold)")
    print("=" * 92)
    report = aligner.align(alt_plato, gold_plato)
    for m in report.matched_nodes:
        print(f"  {m.a_id:<10} <-> {m.b_id:<6} | cos={m.similarity:.4f} | type_match={m.type_match}")
    print("-" * 92)
    print(
        f" Node F1={report.node_prf.f1:.4f} | Hyperedge F1={report.support_hyperedge_exact_prf.f1:.4f} "
        f"| Rebuttal F1={report.rebuttal_prf.f1:.4f} | Undercutter F1={report.undercutter_prf.f1:.4f} "
        f"| Consensus={report.consensus_score:.4f}"
    )


if __name__ == "__main__":
    main()
