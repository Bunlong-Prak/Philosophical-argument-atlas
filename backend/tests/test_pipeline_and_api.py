"""Tests for NeuroSymbolicPipeline and FastAPI endpoints."""

from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from atlas_ml.api import create_app
from atlas_ml.extractor import LLMConfig, NeuroSymbolicPipeline
from atlas_ml.graph_aligner import BipartiteGraphAligner
from atlas_ml.nli_enthymeme import EnthymemeScoreBreakdown
from atlas_ml.rust_bridge import AtlasRustBridge

REPO_ROOT = Path(__file__).resolve().parents[2]


class _FakeLLMClient:
    """Deterministic LLM stub simulating realistic minor quote drift + circular vs valid enthymemes."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        return self.payload


class _FakeNLIScorer:
    def rank_candidates(
        self,
        explicit_premises: list[str],
        conclusion: str,
        candidates: list[str],
    ) -> list[EnthymemeScoreBreakdown]:
        out: list[EnthymemeScoreBreakdown] = []
        for cand in candidates:
            is_trivial = cand.lower().startswith("if ")
            out.append(
                EnthymemeScoreBreakdown(
                    candidate=cand,
                    p_entail_base=0.10,
                    p_entail_with_e=0.92,
                    delta_nli=0.82,
                    p_contradict_with_e=0.01,
                    usurpation_nli=0.95 if is_trivial else 0.05,
                    reverse_entail_nli=0.05,
                    conclusion_sim=0.90 if is_trivial else 0.70,
                    usurpation_score=0.95 if is_trivial else 0.05,
                    material_conditional_sim=0.98 if is_trivial else 0.68,
                    novel_content_ratio=0.0 if is_trivial else 0.75,
                    triviality_penalty=0.95 if is_trivial else 0.0,
                    final_score=-0.50 if is_trivial else 0.78,
                    verdict="trivial_tautology" if is_trivial else "valid_bridge",
                )
            )
        return out


def _bow_embed(texts: list[str], dim: int = 64) -> np.ndarray:
    mat = np.zeros((len(texts), dim), dtype=np.float32)
    for i, t in enumerate(texts):
        for w in t.lower().split():
            mat[i, hash(w.strip(".,;:!?")) % dim] += 1.0
    return mat


def test_neuro_symbolic_pipeline_grounds_audits_and_solves_end_to_end() -> None:
    source = (
        "All inferences from experience, therefore, are effects of custom, "
        "not of reasoning."
    )
    fake_llm_output = {
        "nodes": [
            {
                "id": "P1",
                "proposition": "Experience-based inferences come from custom rather than reasoning.",
                "node_type": "explicit_premise",
                # Minor whitespace drift to verify DeterministicSpanGrounder repair.
                "quote": "effects   of   custom,  not of reasoning.",
                "speaker": "Hume",
                "base_credence": 0.95,
            },
            {
                "id": "E1",
                "proposition": "Habitual expectation cannot provide deductive rational justification.",
                "node_type": "enthymeme",
                "base_credence": 0.85,
            },
            {
                "id": "FAKE",
                "proposition": "Hallucinated sentence not in text.",
                "node_type": "explicit_premise",
                "quote": "Rationalism proves everything from innate axioms.",
                "base_credence": 0.90,
            },
            {
                "id": "C",
                "proposition": "Inferences from experience lack rational demonstration.",
                "node_type": "thesis",
                "quote": "All inferences from experience, therefore, are effects of custom",
                "speaker": "Hume",
                "base_credence": 0.0,
            },
        ],
        "support_hyperedges": [
            {
                "id": "H1",
                "premises": ["P1", "E1", "FAKE"],
                "conclusion": "C",
                "weight": 0.95,
                "scheme": "modus_ponens",
            }
        ],
    }

    pipeline = NeuroSymbolicPipeline(
        llm_client=_FakeLLMClient(fake_llm_output),
        rust_bridge=AtlasRustBridge(repo_root=REPO_ROOT),
        nli_scorer=_FakeNLIScorer(),
    )
    res = pipeline.run(passage_id="hume-test", source_text=source)

    # Hallucinated quote dropped, whitespace-drifted P1 repaired to exact offsets, NLI audited E1,
    # and Rust solver computed Thesis C acceptability and minimal knockouts.
    assert res.dropped_node_ids == ["FAKE"]
    assert res.flagged_enthymeme_ids == []
    assert len(res.enthymeme_audits) == 1
    assert res.enthymeme_audits[0].breakdown.verdict == "valid_bridge"
    assert res.hypergraph.support_hyperedges[0].premises == ["P1", "E1"]
    assert res.solver_report.gradual_df_quad.node_acceptability["C"] > 0.75
    assert res.solver_report.minimal_knockouts[0].removed_node_ids == ["E1"]


def test_fastapi_endpoints_corpus_solve_and_align() -> None:
    app = create_app(
        repo_root=REPO_ROOT,
        nli_scorer=_FakeNLIScorer(),  # type: ignore[arg-type]
        aligner=BipartiteGraphAligner(similarity_threshold=0.70, embed_fn=_bow_embed),
    )
    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["corpus_count"] >= 6

    passages = client.get("/passages")
    assert passages.status_code == 200
    ids = {p["passage_id"] for p in passages.json()}
    assert "kant-third-antinomy" in ids
    assert "plato-euthyphro-dilemma" in ids

    kant = client.get("/passages/kant-third-antinomy")
    assert kant.status_code == 200
    kant_data = kant.json()
    assert kant_data["report"]["dung_semantics"]["grounded_labels"]["Thesis"] == "undecided"

    # Interactive slider simulation: set E1 credence to 0.0 -> Kant Thesis drops to 0.0 and Antithesis wins!
    modified = kant_data["hypergraph"]
    for node in modified["nodes"]:
        if node["id"] == "E1":
            node["base_credence"] = 0.0
    solved = client.post("/solve", json={"hypergraph": modified, "strict_spans": True})
    assert solved.status_code == 200
    s_data = solved.json()
    assert s_data["gradual_df_quad"]["node_acceptability"]["Thesis"] == 0.0
    assert s_data["gradual_df_quad"]["node_acceptability"]["Antithesis"] > 0.75

    # Align endpoint check.
    aligned = client.post(
        "/align",
        json={"graph_a": modified, "graph_b": kant_data["hypergraph"], "similarity_threshold": 0.70},
    )
    assert aligned.status_code == 200
    assert aligned.json()["consensus_score"] == 1.0

    # Cloud extract returns clean 503 when API key is missing.
    assert LLMConfig(provider="groq").resolved_model() == "llama-3.3-70b-versatile"
    extract_resp = client.post(
        "/extract",
        json={
            "passage_id": "test",
            "source_text": "I think, therefore I am, beyond all hyperbolic doubt.",
            "provider": "groq",
        },
    )
    assert extract_resp.status_code == 503
