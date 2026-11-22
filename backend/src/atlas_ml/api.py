"""FastAPI service exposing Argument Atlas solvers, corpus passages, NLI scorer, and alignment."""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .extractor import (
    HttpLLMClient,
    LLMConfig,
    LLMConfigurationError,
    LLMExtractionError,
    NeuroSymbolicPipeline,
    PipelineResult,
    ProviderName,
)
from .graph_aligner import BipartiteGraphAligner, HypergraphAlignmentReport
from .nli_enthymeme import AbductiveNLIScorer, EnthymemeScoreBreakdown
from .rust_bridge import AtlasRustBridge, RustBridgeError, SolverReport
from .schemas import ArgumentHypergraph


class PassageSummary(BaseModel):
    passage_id: str
    filename: str
    node_count: int
    support_count: int
    rebuttal_count: int
    undercutter_count: int
    source_preview: str


class PassageDetail(BaseModel):
    passage_id: str
    filename: str
    argdown: str
    hypergraph: ArgumentHypergraph
    report: SolverReport


class SolveRequest(BaseModel):
    hypergraph: ArgumentHypergraph
    strict_spans: bool = True
    threshold: float = Field(default=0.50, ge=0.0, le=1.0)
    t_norm: Literal["godel", "product"] = "godel"


class SolveArgdownRequest(BaseModel):
    argdown: str
    strict_spans: bool = True
    threshold: float = Field(default=0.50, ge=0.0, le=1.0)
    t_norm: Literal["godel", "product"] = "godel"


class EnthymemeScoreRequest(BaseModel):
    explicit_premises: list[str] = Field(min_length=1)
    conclusion: str
    candidates: list[str] = Field(min_length=1)


class AlignRequest(BaseModel):
    graph_a: ArgumentHypergraph
    graph_b: ArgumentHypergraph
    similarity_threshold: float = Field(default=0.72, ge=0.0, le=1.0)


class ExtractRequest(BaseModel):
    passage_id: str = "custom-passage"
    source_text: str = Field(min_length=10)
    provider: ProviderName = "groq"
    model: Optional[str] = None
    verify_enthymemes: bool = True
    drop_invalid_enthymemes: bool = False


def create_app(
    repo_root: Optional[Path] = None,
    nli_scorer: Optional[AbductiveNLIScorer] = None,
    aligner: Optional[BipartiteGraphAligner] = None,
) -> FastAPI:
    root = (repo_root or Path(__file__).resolve().parents[3]).resolve()
    corpus_dir = root / "datasets" / "phil-args"
    bridge = AtlasRustBridge(repo_root=root)

    state: dict[str, object] = {
        "scorer": nli_scorer,
        "aligner": aligner,
    }

    def get_scorer() -> AbductiveNLIScorer:
        if state["scorer"] is None:
            state["scorer"] = AbductiveNLIScorer()
        return state["scorer"]  # type: ignore[return-value]

    def get_aligner() -> BipartiteGraphAligner:
        if state["aligner"] is None:
            state["aligner"] = BipartiteGraphAligner()
        return state["aligner"]  # type: ignore[return-value]

    app = FastAPI(
        title="Argument Atlas API",
        version="0.1.0",
        description="Neuro-symbolic Bipolar Argumentation Hypergraph workbench API.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, object]:
        files = sorted(corpus_dir.glob("*.argdown")) if corpus_dir.exists() else []
        release_exists = (root / "target" / "release" / "atlas-cli").exists()
        return {
            "status": "ok",
            "corpus_count": len(files),
            "rust_release_binary": release_exists,
        }

    @app.get("/passages", response_model=list[PassageSummary])
    def list_passages() -> list[PassageSummary]:
        if not corpus_dir.exists():
            return []
        summaries: list[PassageSummary] = []
        for path in sorted(corpus_dir.glob("*.argdown")):
            graph = bridge.load_argdown(path)
            preview = (graph.source_text or "")[:140].strip()
            summaries.append(
                PassageSummary(
                    passage_id=graph.passage_id,
                    filename=path.name,
                    node_count=len(graph.nodes),
                    support_count=len(graph.support_hyperedges),
                    rebuttal_count=len(graph.rebutting_attacks),
                    undercutter_count=len(graph.undercutting_attacks),
                    source_preview=preview,
                )
            )
        return summaries

    @app.get("/passages/{passage_id}", response_model=PassageDetail)
    def get_passage(passage_id: str) -> PassageDetail:
        if corpus_dir.exists():
            for path in sorted(corpus_dir.glob("*.argdown")):
                graph = bridge.load_argdown(path)
                if graph.passage_id == passage_id:
                    report = bridge.solve(graph, strict_spans=True)
                    return PassageDetail(
                        passage_id=graph.passage_id,
                        filename=path.name,
                        argdown=path.read_text(encoding="utf-8"),
                        hypergraph=graph,
                        report=report,
                    )
        raise HTTPException(status_code=404, detail=f"Passage '{passage_id}' not found.")

    @app.post("/solve", response_model=SolverReport)
    def solve_graph(req: SolveRequest) -> SolverReport:
        try:
            return bridge.solve(
                req.hypergraph,
                strict_spans=req.strict_spans,
                threshold=req.threshold,
                t_norm=req.t_norm,
            )
        except RustBridgeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/solve-argdown", response_model=SolverReport)
    def solve_argdown(req: SolveArgdownRequest) -> SolverReport:
        try:
            return bridge.solve_argdown(
                req.argdown,
                strict_spans=req.strict_spans,
                threshold=req.threshold,
                t_norm=req.t_norm,
            )
        except RustBridgeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/parse-argdown", response_model=PassageDetail)
    def parse_argdown(req: SolveArgdownRequest) -> PassageDetail:
        """Parses `.argdown` text into a hypergraph plus its initial Rust solver report."""
        try:
            graph = bridge.parse_argdown_text(req.argdown)
            report = bridge.solve(
                graph,
                strict_spans=req.strict_spans and bool(graph.source_text),
                threshold=req.threshold,
                t_norm=req.t_norm,
            )
            return PassageDetail(
                passage_id=graph.passage_id,
                filename=f"{graph.passage_id}.argdown",
                argdown=req.argdown,
                hypergraph=graph,
                report=report,
            )
        except RustBridgeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/score-enthymemes", response_model=list[EnthymemeScoreBreakdown])
    def score_enthymemes(req: EnthymemeScoreRequest) -> list[EnthymemeScoreBreakdown]:
        scorer = get_scorer()
        return scorer.rank_candidates(
            explicit_premises=req.explicit_premises,
            conclusion=req.conclusion,
            candidates=req.candidates,
        )

    @app.post("/align", response_model=HypergraphAlignmentReport)
    def align_graphs(req: AlignRequest) -> HypergraphAlignmentReport:
        graph_aligner = get_aligner()
        return graph_aligner.align(
            req.graph_a,
            req.graph_b,
            threshold=req.similarity_threshold,
        )

    @app.post("/extract", response_model=PipelineResult)
    def extract_from_text(req: ExtractRequest) -> PipelineResult:
        llm_client = HttpLLMClient(LLMConfig(provider=req.provider, model=req.model))
        pipeline = NeuroSymbolicPipeline(
            llm_client=llm_client,
            rust_bridge=bridge,
            nli_scorer=get_scorer() if req.verify_enthymemes else None,
        )
        try:
            return pipeline.run(
                passage_id=req.passage_id,
                source_text=req.source_text,
                verify_enthymemes=req.verify_enthymemes,
                drop_invalid_enthymemes=req.drop_invalid_enthymemes,
            )
        except LLMConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except (LLMExtractionError, RustBridgeError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return app


app = create_app()
