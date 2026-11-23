"""Tests for the expanded 6-passage PhilArgs corpus and Bipartite Semantic Graph Aligner."""

from pathlib import Path

import numpy as np
import pytest

from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.rust_bridge import AtlasRustBridge
from atlas_ml.schemas import (
    ArgumentHypergraph,
    NodeType,
    PropositionNode,
    RebuttingAttack,
    SupportHyperedge,
    UndercuttingAttack,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"
LENSES_DIR = REPO_ROOT / "datasets" / "hermeneutic-lenses"


def _bow_hash_embed(texts: list[str], dim: int = 128) -> np.ndarray:
    """Fast deterministic bag-of-words projection for offline unit testing."""
    mat = np.zeros((len(texts), dim), dtype=np.float32)
    for row_idx, text in enumerate(texts):
        for tok in text.lower().split():
            cleaned = tok.strip(".,;:!?\"'()")
            if cleaned:
                mat[row_idx, hash(cleaned) % dim] += 1.0
    return mat


def test_expanded_corpus_covers_rebuttals_undercutters_and_antinomy_cycles() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    files = sorted(PHIL_ARGS_DIR.glob("*.argdown"))
    assert len(files) >= 6

    reports = {
        path.stem: bridge.solve(bridge.load_argdown(path), strict_spans=True)
        for path in files
    }

    # Plato Euthyphro: Socrates undercuts <H1> and rebuts Euthyphro's divine-command Thesis [C].
    plato = reports["04_plato_euthyphro_dilemma"]
    assert plato.dung_semantics.grounded_labels["C"] == "out"
    assert plato.dung_semantics.grounded_labels["U1"] == "in"
    assert plato.gradual_df_quad.hyperedge_transmission["H1"] < 0.20
    assert plato.gradual_df_quad.node_acceptability["C"] == pytest.approx(0.0, abs=1e-6)

    # Kant Third Antinomy: Thesis <-> Antithesis symmetric deadlock (Undecided under Grounded,
    # splitting cleanly into 2 Preferred and 2 Stable worldviews).
    kant = reports["05_kant_third_antinomy"]
    assert kant.gradual_df_quad.converged is True
    assert kant.dung_semantics.grounded_labels["Thesis"] == "undecided"
    assert kant.dung_semantics.grounded_labels["Antithesis"] == "undecided"
    assert len(kant.dung_semantics.preferred) == 2
    assert len(kant.dung_semantics.stable) == 2
    assert kant.gradual_df_quad.node_acceptability["Thesis"] == pytest.approx(
        kant.gradual_df_quad.node_acceptability["Antithesis"], abs=1e-6
    )

    # J.S. Mill On Liberty: Mill's fallibilism undercuts <H_censor> and defeats [Censorship].
    mill = reports["06_mill_on_liberty_infallibility"]
    assert mill.dung_semantics.grounded_labels["C"] == "in"
    assert mill.dung_semantics.grounded_labels["Censorship"] == "out"
    assert mill.gradual_df_quad.node_acceptability["C"] > 0.85
    assert mill.gradual_df_quad.hyperedge_transmission["H_censor"] < 0.15


def test_bipartite_graph_aligner_handles_renamed_ids_and_structural_divergences() -> None:
    # Build a gold graph with support hyperedge, rebuttal, and undercutter.
    gold = ArgumentHypergraph(
        passage_id="euthyphro-sample",
        nodes=[
            PropositionNode(
                id="P1",
                proposition="Piety is whatever is loved by the gods",
                node_type=NodeType.EXPLICIT_PREMISE,
                base_credence=0.85,
            ),
            PropositionNode(
                id="E1",
                proposition="Divine love constitutes the essence of holiness",
                node_type=NodeType.ENTHYMEME,
                base_credence=0.80,
            ),
            PropositionNode(
                id="C",
                proposition="Holiness exists because the gods love it",
                node_type=NodeType.THESIS,
                base_credence=0.0,
            ),
            PropositionNode(
                id="U1",
                proposition="Being loved is an extrinsic effect rather than essence",
                node_type=NodeType.OBJECTION,
                base_credence=0.90,
            ),
        ],
        support_hyperedges=[
            SupportHyperedge(id="H1", premises=["P1", "E1"], conclusion="C", weight=0.9)
        ],
        rebutting_attacks=[
            RebuttingAttack(id="R1", attacker="U1", target="C", weight=0.95)
        ],
        undercutting_attacks=[
            UndercuttingAttack(id="UND1", attacker="U1", target_hyperedge="H1", weight=0.95)
        ],
    )

    # Prediction A: identical structure with completely renamed node/edge IDs and minor phrasing shifts.
    pred_isomorphic = ArgumentHypergraph(
        passage_id="euthyphro-pred",
        nodes=[
            PropositionNode(
                id="n_obj",
                proposition="Being loved is an extrinsic effect not essence",
                node_type=NodeType.OBJECTION,
                base_credence=0.90,
            ),
            PropositionNode(
                id="n_prem",
                proposition="Piety is whatever is loved by the gods",
                node_type=NodeType.EXPLICIT_PREMISE,
                base_credence=0.85,
            ),
            PropositionNode(
                id="n_enth",
                proposition="Divine love constitutes essence of holiness",
                node_type=NodeType.ENTHYMEME,
                base_credence=0.80,
            ),
            PropositionNode(
                id="n_thesis",
                proposition="Holiness exists because gods love it",
                node_type=NodeType.THESIS,
                base_credence=0.0,
            ),
        ],
        support_hyperedges=[
            SupportHyperedge(
                id="edge_alpha",
                premises=["n_prem", "n_enth"],
                conclusion="n_thesis",
                weight=0.9,
            )
        ],
        rebutting_attacks=[
            RebuttingAttack(id="reb_99", attacker="n_obj", target="n_thesis", weight=0.95)
        ],
        undercutting_attacks=[
            UndercuttingAttack(
                id="und_99", attacker="n_obj", target_hyperedge="edge_alpha", weight=0.95
            )
        ],
    )

    aligner = BipartiteGraphAligner(similarity_threshold=0.72, embed_fn=_bow_hash_embed)
    iso_report = aligner.align(pred_isomorphic, gold)
    assert iso_report.node_prf.f1 == 1.0
    assert iso_report.node_type_accuracy == 1.0
    assert iso_report.enthymeme_prf.f1 == 1.0
    assert iso_report.support_hyperedge_exact_prf.f1 == 1.0
    assert iso_report.rebuttal_prf.f1 == 1.0
    assert iso_report.undercutter_prf.f1 == 1.0
    assert iso_report.consensus_score == 1.0

    # Prediction B: omits the implicit enthymeme E1 and drops the undercutter UND1.
    pred_shallow = ArgumentHypergraph(
        passage_id="euthyphro-shallow",
        nodes=[n for n in pred_isomorphic.nodes if n.id != "n_enth"],
        support_hyperedges=[
            SupportHyperedge(
                id="edge_shallow",
                premises=["n_prem"],
                conclusion="n_thesis",
                weight=0.9,
            )
        ],
        rebutting_attacks=[
            RebuttingAttack(id="reb_99", attacker="n_obj", target="n_thesis", weight=0.95)
        ],
        undercutting_attacks=[],
    )

    shallow_report = aligner.align(pred_shallow, gold)
    assert shallow_report.explicit_node_prf.f1 == 1.0
    assert shallow_report.enthymeme_prf.f1 == 0.0
    assert shallow_report.support_hyperedge_exact_prf.f1 == 0.0
    # Partial credit: link (P1 -> C) is still recovered even though E1 was missed!
    assert shallow_report.support_link_prf.matched == 1
    assert shallow_report.support_link_prf.f1 == pytest.approx(2 / 3, abs=1e-3)
    assert shallow_report.rebuttal_prf.f1 == 1.0
    assert shallow_report.undercutter_prf.f1 == 0.0
    assert shallow_report.consensus_score < 0.70


def test_hermeneutic_lenses_strict_spans_solver_and_divergence() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    lens_files = sorted(LENSES_DIR.glob("*.argdown"))
    assert len(lens_files) >= 4

    solved_lenses = {
        path.stem: bridge.solve(bridge.load_argdown(path), strict_spans=True)
        for path in lens_files
    }

    # Descartes Lichtenberg lens breaks Cogito justification via grammatical undercutter.
    lich = solved_lenses["01_descartes_lichtenberg_lens"]
    assert lich.dung_semantics.grounded_labels["C"] == "out"
    assert lich.gradual_df_quad.node_acceptability["C"] < 0.35

    # Dostoevsky Theodicy lens weakens E1 and flips Thesis C out.
    theo = solved_lenses["03_dostoevsky_theodicy_lens"]
    assert theo.dung_semantics.grounded_labels["C"] == "out"
    assert theo.gradual_df_quad.node_acceptability["C"] < 0.40

    # Kant Compatibilist lens resolves the symmetric antinomy toward Antithesis.
    compat = solved_lenses["05_kant_compatibilist_lens"]
    assert compat.dung_semantics.grounded_labels["Antithesis"] == "in"
    assert compat.gradual_df_quad.node_acceptability["Antithesis"] > 0.70
    assert compat.gradual_df_quad.node_acceptability["Thesis"] == pytest.approx(0.0, abs=1e-6)
