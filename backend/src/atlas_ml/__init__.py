"""Neuro-symbolic computational philosophy package for Argument Atlas."""

from .graph_aligner import BipartiteGraphAligner, HypergraphAlignmentReport
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
from .rust_bridge import AtlasRustBridge, SolverReport

__all__ = [
    "ArgumentHypergraph",
    "AtlasRustBridge",
    "BipartiteGraphAligner",
    "DeterministicSpanGrounder",
    "HypergraphAlignmentReport",
    "NodeType",
    "PropositionNode",
    "RebuttingAttack",
    "SolverReport",
    "SpanGroundingError",
    "SupportHyperedge",
    "TextSpan",
    "UndercuttingAttack",
]
