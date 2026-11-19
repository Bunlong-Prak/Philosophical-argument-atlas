"""Unit tests for deterministic character-span grounding and Rust solver IPC bridge."""

from pathlib import Path

import pytest

from atlas_ml.rust_bridge import AtlasRustBridge, RustBridgeError
from atlas_ml.schemas import (
    ArgumentHypergraph,
    DeterministicSpanGrounder,
    NodeType,
    PropositionNode,
    SpanGroundingError,
    TextSpan,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PHIL_ARGS_DIR = REPO_ROOT / "datasets" / "phil-args"


def test_deterministic_span_grounder_handles_normalization_and_fuzzy_drift() -> None:
    src = (
        "All inferences from experience, therefore, are effects of custom, "
        "not of reasoning."
    )

    # Smart quotes + extra whitespace drift repaired deterministically.
    span_ws = DeterministicSpanGrounder.ground_quote(
        src,
        "effects   of   custom,  not of reasoning.",
    )
    assert src[span_ws.start_char : span_ws.end_char] == "effects of custom, not of reasoning."
    assert span_ws.verbatim_quote == "effects of custom, not of reasoning."

    # Minor 1-word omission repaired via bounded fuzzy alignment.
    span_fuzzy = DeterministicSpanGrounder.ground_quote(
        src,
        "All inferences from experience are effects of custom",
        allow_fuzzy=True,
    )
    assert src[span_fuzzy.start_char : span_fuzzy.end_char] == span_fuzzy.verbatim_quote
    assert "All inferences from experience" in span_fuzzy.verbatim_quote

    # Fabricated quote strictly rejected.
    with pytest.raises(SpanGroundingError):
        DeterministicSpanGrounder.ground_quote(
            src,
            "Pure reason proves every causal necessity a priori.",
        )


def test_span_grounder_disambiguates_duplicate_substrings_by_hint() -> None:
    src = "I think, therefore I am. Even if I doubt, I think."
    second_hit = DeterministicSpanGrounder.ground_quote(src, "I think", hint_start=40)
    assert second_hit.start_char == 42
    assert second_hit.end_char == 49
    assert src[second_hit.start_char : second_hit.end_char] == "I think"


def test_rust_bridge_loads_grounds_and_solves_all_phil_args() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    files = sorted(PHIL_ARGS_DIR.glob("*.argdown"))
    assert len(files) >= 3

    for path in files:
        graph = bridge.load_argdown(path)
        repaired = DeterministicSpanGrounder.ground_hypergraph(graph)
        report = bridge.solve(repaired, strict_spans=True)
        assert report.gradual_df_quad.converged is True
        assert report.thesis_id is not None
        thesis_score = report.gradual_df_quad.node_acceptability[report.thesis_id]
        assert 0.0 <= thesis_score <= 1.0


def test_rust_bridge_rejects_corrupted_span_and_propagates_knockout() -> None:
    bridge = AtlasRustBridge(repo_root=REPO_ROOT)
    rebellion_path = PHIL_ARGS_DIR / "03_dostoevsky_ivan_rebellion.argdown"
    graph = bridge.load_argdown(rebellion_path)

    # Corrupt a span deliberately -> Rust strict verification must reject it.
    corrupted_nodes = [
        n.model_copy(
            update={
                "span": TextSpan(
                    start_char=0,
                    end_char=10,
                    verbatim_quote="FABRICATED",
                )
            }
        )
        if n.id == "P2"
        else n
        for n in graph.nodes
    ]
    corrupted = graph.model_copy(update={"nodes": corrupted_nodes})
    with pytest.raises(RustBridgeError, match="span quote mismatch"):
        bridge.solve(corrupted, strict_spans=True)

    # Knocking out E1 ("no utilitarian good justifies torturing an innocent child") collapses C to 0.0.
    knocked_nodes = [
        n.model_copy(update={"base_credence": 0.0}) if n.id == "E1" else n
        for n in graph.nodes
    ]
    knocked = graph.model_copy(update={"nodes": knocked_nodes})
    report = bridge.solve(knocked, strict_spans=True)
    assert report.gradual_df_quad.node_acceptability["C"] == pytest.approx(0.0, abs=1e-6)
    assert "C" not in report.dung_semantics.grounded
