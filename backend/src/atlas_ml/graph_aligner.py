"""Bipartite semantic graph alignment & evaluation metrics for Bipolar Argumentation Hypergraphs.

Serves two core roles in Argument Atlas:
1. Benchmark Evaluation (Milestone 3): Predicted vs. Gold Hypergraph node/hyperedge/attack F1.
2. Hermeneutic Prism (Milestone 4): Model A vs. Model B structural consensus & divergence.
"""

from __future__ import annotations

from typing import Callable, Optional

import numpy as np
from pydantic import BaseModel
from scipy.optimize import linear_sum_assignment

from .schemas import ArgumentHypergraph, NodeType

EmbedFn = Callable[[list[str]], np.ndarray]


class PrecisionRecallF1(BaseModel):
    precision: float
    recall: float
    f1: float
    matched: int
    total_a: int
    total_b: int


class NodeMatch(BaseModel):
    a_id: str
    b_id: str
    similarity: float
    a_type: NodeType
    b_type: NodeType
    type_match: bool


class HypergraphAlignmentReport(BaseModel):
    similarity_threshold: float
    matched_nodes: list[NodeMatch]
    unmatched_a_nodes: list[str]
    unmatched_b_nodes: list[str]
    node_prf: PrecisionRecallF1
    node_type_accuracy: float
    explicit_node_prf: PrecisionRecallF1
    enthymeme_prf: PrecisionRecallF1
    support_hyperedge_exact_prf: PrecisionRecallF1
    support_link_prf: PrecisionRecallF1
    rebuttal_prf: PrecisionRecallF1
    undercutter_prf: PrecisionRecallF1
    macro_relation_f1: float
    consensus_score: float


def _compute_prf(matched: int, total_a: int, total_b: int) -> PrecisionRecallF1:
    if total_a == 0 and total_b == 0:
        return PrecisionRecallF1(
            precision=1.0, recall=1.0, f1=1.0, matched=0, total_a=0, total_b=0
        )
    precision = matched / total_a if total_a > 0 else 0.0
    recall = matched / total_b if total_b > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    return PrecisionRecallF1(
        precision=round(precision, 4),
        recall=round(recall, 4),
        f1=round(f1, 4),
        matched=matched,
        total_a=total_a,
        total_b=total_b,
    )


def _l2_normalize(mat: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    norms = np.where(norms == 0.0, 1.0, norms)
    return mat / norms


class BipartiteGraphAligner:
    """Aligns two `ArgumentHypergraph` instances via Hungarian maximum-weight matching."""

    def __init__(
        self,
        embed_model_id: str = "BAAI/bge-small-en-v1.5",
        similarity_threshold: float = 0.72,
        embed_fn: Optional[EmbedFn] = None,
        device: Optional[str] = None,
    ) -> None:
        self.similarity_threshold = similarity_threshold
        self._embed_fn = embed_fn
        self._embed_model_id = embed_model_id
        self._device = device
        self._st_model = None

    def _embed_texts(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 1), dtype=np.float32)

        if self._embed_fn is not None:
            raw = np.asarray(self._embed_fn(texts), dtype=np.float32)
            return _l2_normalize(raw)

        if self._st_model is None:
            from sentence_transformers import SentenceTransformer

            self._st_model = SentenceTransformer(self._embed_model_id, device=self._device)

        embs = self._st_model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
        return np.asarray(embs, dtype=np.float32)

    def align(
        self,
        graph_a: ArgumentHypergraph,
        graph_b: ArgumentHypergraph,
        threshold: Optional[float] = None,
    ) -> HypergraphAlignmentReport:
        tau = self.similarity_threshold if threshold is None else threshold
        nodes_a = graph_a.nodes
        nodes_b = graph_b.nodes

        matched_nodes: list[NodeMatch] = []
        a_to_b: dict[str, str] = {}

        if nodes_a and nodes_b:
            emb_a = self._embed_texts([n.proposition for n in nodes_a])
            emb_b = self._embed_texts([n.proposition for n in nodes_b])
            sim_matrix = emb_a @ emb_b.T

            # Zero out pairs below threshold tau so Hungarian never sacrifices a valid match.
            # Apply a small epistemic-role tie-breaker (+0.05 for matching explicit vs. enthymeme
            # partition, +0.02 for identical NodeType) to prevent near-ties in embedding space
            # from swapping an implicit enthymeme with its derived conclusion.
            score_matrix = np.zeros_like(sim_matrix)
            for r, na in enumerate(nodes_a):
                a_imp = na.node_type == NodeType.ENTHYMEME
                for c, nb in enumerate(nodes_b):
                    sim = float(sim_matrix[r, c])
                    if sim >= tau:
                        b_imp = nb.node_type == NodeType.ENTHYMEME
                        role_bonus = 0.05 if (a_imp == b_imp) else 0.0
                        type_bonus = 0.02 if (na.node_type == nb.node_type) else 0.0
                        score_matrix[r, c] = sim + role_bonus + type_bonus

            row_ind, col_ind = linear_sum_assignment(-score_matrix)

            for r, c in zip(row_ind, col_ind):
                sim = float(sim_matrix[r, c])
                if sim >= tau:
                    na = nodes_a[r]
                    nb = nodes_b[c]
                    a_to_b[na.id] = nb.id
                    matched_nodes.append(
                        NodeMatch(
                            a_id=na.id,
                            b_id=nb.id,
                            similarity=round(sim, 4),
                            a_type=na.node_type,
                            b_type=nb.node_type,
                            type_match=(na.node_type == nb.node_type),
                        )
                    )

        unmatched_a = [n.id for n in nodes_a if n.id not in a_to_b]
        matched_b_ids = set(a_to_b.values())
        unmatched_b = [n.id for n in nodes_b if n.id not in matched_b_ids]

        node_prf = _compute_prf(len(matched_nodes), len(nodes_a), len(nodes_b))
        type_acc = (
            sum(1 for m in matched_nodes if m.type_match) / len(matched_nodes)
            if matched_nodes
            else (1.0 if not nodes_a and not nodes_b else 0.0)
        )

        # Category-level breakdown: explicit non-enthymeme vs. enthymeme nodes.
        explicit_a = sum(1 for n in nodes_a if n.node_type != NodeType.ENTHYMEME)
        explicit_b = sum(1 for n in nodes_b if n.node_type != NodeType.ENTHYMEME)
        explicit_matched = sum(
            1
            for m in matched_nodes
            if m.a_type != NodeType.ENTHYMEME and m.b_type != NodeType.ENTHYMEME
        )
        explicit_prf = _compute_prf(explicit_matched, explicit_a, explicit_b)

        enth_a = sum(1 for n in nodes_a if n.node_type == NodeType.ENTHYMEME)
        enth_b = sum(1 for n in nodes_b if n.node_type == NodeType.ENTHYMEME)
        enth_matched = sum(
            1
            for m in matched_nodes
            if m.a_type == NodeType.ENTHYMEME and m.b_type == NodeType.ENTHYMEME
        )
        enthymeme_prf = _compute_prf(enth_matched, enth_a, enth_b)

        # Canonical Support Hyperedge matching (invariant to edge ID naming).
        HyperSig = tuple[frozenset[str], str]
        sig_by_edge_a: dict[str, HyperSig] = {}
        mapped_hyper_a: set[HyperSig] = set()
        for e in graph_a.support_hyperedges:
            if e.conclusion in a_to_b and all(p in a_to_b for p in e.premises):
                sig: HyperSig = (frozenset(a_to_b[p] for p in e.premises), a_to_b[e.conclusion])
                sig_by_edge_a[e.id] = sig
                mapped_hyper_a.add(sig)

        sig_by_edge_b: dict[str, HyperSig] = {
            e.id: (frozenset(e.premises), e.conclusion) for e in graph_b.support_hyperedges
        }
        hyper_b_set = set(sig_by_edge_b.values())
        hyper_matched = len(mapped_hyper_a & hyper_b_set)
        support_hyperedge_exact_prf = _compute_prf(
            hyper_matched,
            len(graph_a.support_hyperedges),
            len(graph_b.support_hyperedges),
        )

        # Pairwise (premise -> conclusion) link projection F1 for partial-credit scoring.
        links_a_mapped: set[tuple[str, str]] = set()
        total_links_a = 0
        for e in graph_a.support_hyperedges:
            for p in e.premises:
                total_links_a += 1
                if p in a_to_b and e.conclusion in a_to_b:
                    links_a_mapped.add((a_to_b[p], a_to_b[e.conclusion]))

        links_b: set[tuple[str, str]] = {
            (p, e.conclusion) for e in graph_b.support_hyperedges for p in e.premises
        }
        support_link_prf = _compute_prf(
            len(links_a_mapped & links_b),
            total_links_a,
            len(links_b),
        )

        # Rebutting Attack matching.
        rebuttals_a_mapped = {
            (a_to_b[r.attacker], a_to_b[r.target])
            for r in graph_a.rebutting_attacks
            if r.attacker in a_to_b and r.target in a_to_b
        }
        rebuttals_b = {(r.attacker, r.target) for r in graph_b.rebutting_attacks}
        rebuttal_prf = _compute_prf(
            len(rebuttals_a_mapped & rebuttals_b),
            len(graph_a.rebutting_attacks),
            len(graph_b.rebutting_attacks),
        )

        # Undercutting Attack matching (u -> canonical hyperedge signature).
        undercuts_a_mapped = {
            (a_to_b[u.attacker], sig_by_edge_a[u.target_hyperedge])
            for u in graph_a.undercutting_attacks
            if u.attacker in a_to_b and u.target_hyperedge in sig_by_edge_a
        }
        undercuts_b = {
            (u.attacker, sig_by_edge_b[u.target_hyperedge])
            for u in graph_b.undercutting_attacks
            if u.target_hyperedge in sig_by_edge_b
        }
        undercutter_prf = _compute_prf(
            len(undercuts_a_mapped & undercuts_b),
            len(graph_a.undercutting_attacks),
            len(graph_b.undercutting_attacks),
        )

        # Macro relation F1 over relation families that are non-empty in at least one graph.
        active_rel_f1s: list[float] = []
        for rel_prf in (support_hyperedge_exact_prf, rebuttal_prf, undercutter_prf):
            if rel_prf.total_a > 0 or rel_prf.total_b > 0:
                active_rel_f1s.append(rel_prf.f1)

        macro_rel_f1 = (
            sum(active_rel_f1s) / len(active_rel_f1s)
            if active_rel_f1s
            else 1.0
        )
        consensus = 0.5 * (node_prf.f1 + macro_rel_f1)

        return HypergraphAlignmentReport(
            similarity_threshold=tau,
            matched_nodes=matched_nodes,
            unmatched_a_nodes=unmatched_a,
            unmatched_b_nodes=unmatched_b,
            node_prf=node_prf,
            node_type_accuracy=round(type_acc, 4),
            explicit_node_prf=explicit_prf,
            enthymeme_prf=enthymeme_prf,
            support_hyperedge_exact_prf=support_hyperedge_exact_prf,
            support_link_prf=support_link_prf,
            rebuttal_prf=rebuttal_prf,
            undercutter_prf=undercutter_prf,
            macro_relation_f1=round(macro_rel_f1, 4),
            consensus_score=round(consensus, 4),
        )
