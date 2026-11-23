"""Hermeneutic Prism benchmark evaluating corpus vs. rival lenses across BGE similarity thresholds."""

from __future__ import annotations

from pathlib import Path

from atlas_ml.api import _parse_frontmatter_metadata
from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.rust_bridge import AtlasRustBridge

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"
LENSES_DIR = REPO_ROOT / "datasets" / "hermeneutic-lenses"


def main() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    aligner = BipartiteGraphAligner(
        embed_model_id="BAAI/bge-small-en-v1.5",
        similarity_threshold=0.72,
    )

    gold_by_id = {}
    gold_reports = {}
    for p in sorted(PHIL_ARGS_DIR.glob("*.argdown")):
        g = bridge.load_argdown(p)
        gold_by_id[g.passage_id] = g
        gold_reports[g.passage_id] = bridge.solve(g, strict_spans=True)

    print("=" * 100)
    print(" HERMENEUTIC PRISM BENCHMARK (BAAI/bge-small-en-v1.5 + Rust DF-QuAD Delta)")
    print("=" * 100)

    for lens_path in sorted(LENSES_DIR.glob("*.argdown")):
        raw = lens_path.read_text(encoding="utf-8")
        meta = _parse_frontmatter_metadata(raw)
        target_id = meta.get("target_passage_id", "")
        title = meta.get("lens_title", lens_path.stem)
        if target_id not in gold_by_id:
            continue

        gold = gold_by_id[target_id]
        gold_rep = gold_reports[target_id]
        lens = bridge.load_argdown(lens_path)
        lens_rep = bridge.solve(lens, strict_spans=True)

        tid_a = gold_rep.thesis_id or "-"
        tid_b = lens_rep.thesis_id or "-"
        score_a = gold_rep.gradual_df_quad.node_acceptability.get(tid_a, 0.0)
        score_b = lens_rep.gradual_df_quad.node_acceptability.get(tid_b, 0.0)

        print(f"\n[{target_id}] vs [{lens.passage_id}] ({title})")
        print(
            f"  Thesis σ*: gold[{tid_a}]={score_a:.4f} ({gold_rep.dung_semantics.grounded_labels.get(tid_a)}) "
            f"-> lens[{tid_b}]={score_b:.4f} ({lens_rep.dung_semantics.grounded_labels.get(tid_b)}) "
            f"| Δ={score_b - score_a:+.4f}"
        )

        for tau in (0.65, 0.72, 0.80):
            rep = aligner.align(lens, gold, threshold=tau)
            print(
                f"  τ={tau:.2f} | ExplicitF1={rep.explicit_node_prf.f1:.3f} "
                f"| EnthF1={rep.enthymeme_prf.f1:.3f} "
                f"| SupEdgeF1={rep.support_hyperedge_exact_prf.f1:.3f} "
                f"| RebF1={rep.rebuttal_prf.f1:.3f} "
                f"| UndF1={rep.undercutter_prf.f1:.3f} "
                f"| Consensus={rep.consensus_score:.3f}"
            )


if __name__ == "__main__":
    main()
