"""Exports PhilArgs-12, Hermeneutic Lenses, and BGE similarity matrices to `web/public/corpus-bundle.json`."""

from __future__ import annotations

import json
from pathlib import Path

from atlas_ml.api import HermeneuticLensDetail, PassageDetail, PassageSummary, _parse_frontmatter_metadata
from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.rust_bridge import AtlasRustBridge

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"
LENSES_DIR = REPO_ROOT / "datasets" / "hermeneutic-lenses"
OUT_PATH = REPO_ROOT / "web" / "public" / "corpus-bundle.json"


def main() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    aligner = BipartiteGraphAligner(embed_model_id="BAAI/bge-small-en-v1.5")

    summaries: list[dict] = []
    details_by_id: dict[str, dict] = {}
    all_graphs = {}

    for path in sorted(PHIL_ARGS_DIR.glob("*.argdown")):
        raw = path.read_text(encoding="utf-8")
        graph = bridge.load_argdown(path)
        report = bridge.solve(graph, strict_spans=True)
        preview = (graph.source_text or "")[:140].strip()
        summary = PassageSummary(
            passage_id=graph.passage_id,
            filename=path.name,
            node_count=len(graph.nodes),
            support_count=len(graph.support_hyperedges),
            rebuttal_count=len(graph.rebutting_attacks),
            undercutter_count=len(graph.undercutting_attacks),
            source_preview=preview,
        )
        detail = PassageDetail(
            passage_id=graph.passage_id,
            filename=path.name,
            argdown=raw,
            hypergraph=graph,
            report=report,
        )
        summaries.append(summary.model_dump())
        details_by_id[graph.passage_id] = detail.model_dump()
        all_graphs[graph.passage_id] = graph

    lenses: list[dict] = []
    for path in sorted(LENSES_DIR.glob("*.argdown")):
        raw = path.read_text(encoding="utf-8")
        meta = _parse_frontmatter_metadata(raw)
        graph = bridge.load_argdown(path)
        report = bridge.solve(graph, strict_spans=bool(graph.source_text))
        lens = HermeneuticLensDetail(
            lens_id=graph.passage_id,
            target_passage_id=meta.get("target_passage_id", ""),
            title=meta.get("lens_title", graph.passage_id),
            description=meta.get("lens_summary", ""),
            filename=path.name,
            argdown=raw,
            hypergraph=graph,
            report=report,
        )
        lenses.append(lens.model_dump())
        all_graphs[graph.passage_id] = graph

    # Precompute compact BGE-small cosine similarity matrices for every paired (passage, lens)
    # plus self-matrices so static zero-backend deployments support live threshold sliders.
    unique_propositions: list[str] = []
    prop_to_idx: dict[str, int] = {}
    for g in all_graphs.values():
        for n in g.nodes:
            if n.proposition not in prop_to_idx:
                prop_to_idx[n.proposition] = len(unique_propositions)
                unique_propositions.append(n.proposition)

    emb_matrix = aligner._embed_texts(unique_propositions)
    # Store quantized 4-decimal embedding vectors per proposition (~85 KB total for ~80 propositions)
    # so ANY pair of bundled graphs can compute exact BGE cosine similarity client-side!
    proposition_embeddings: dict[str, list[float]] = {
        prop: [round(float(x), 4) for x in emb_matrix[idx]]
        for prop, idx in prop_to_idx.items()
    }

    bundle = {
        "version": 1,
        "passages": summaries,
        "passage_details": details_by_id,
        "lenses": lenses,
        "proposition_embeddings": proposition_embeddings,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(bundle, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_PATH.stat().st_size / 1024.0
    print(
        f"Wrote {OUT_PATH} ({size_kb:.1f} KB): {len(summaries)} passages, "
        f"{len(lenses)} lenses, {len(proposition_embeddings)} BGE embeddings."
    )


if __name__ == "__main__":
    main()
