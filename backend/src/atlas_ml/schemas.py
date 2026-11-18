"""Pydantic v2 mirror of `atlas_core::model` and deterministic character-span grounder."""

from __future__ import annotations

import difflib
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class NodeType(str, Enum):
    THESIS = "thesis"
    EXPLICIT_PREMISE = "explicit_premise"
    ENTHYMEME = "enthymeme"
    OBJECTION = "objection"
    COUNTERFACTUAL_ASSUMPTION = "counterfactual_assumption"


class TextSpan(BaseModel):
    start_char: int = Field(ge=0)
    end_char: int = Field(gt=0)
    verbatim_quote: str


class PropositionNode(BaseModel):
    id: str
    proposition: str
    node_type: NodeType
    span: Optional[TextSpan] = None
    speaker: Optional[str] = None
    base_credence: float = Field(ge=0.0, le=1.0)


class SupportHyperedge(BaseModel):
    id: str
    premises: list[str] = Field(min_length=1)
    conclusion: str
    weight: float = Field(ge=0.0, le=1.0)
    scheme: Optional[str | dict[str, str]] = None


class RebuttingAttack(BaseModel):
    id: str
    attacker: str
    target: str
    weight: float = Field(ge=0.0, le=1.0)


class UndercuttingAttack(BaseModel):
    id: str
    attacker: str
    target_hyperedge: str
    weight: float = Field(ge=0.0, le=1.0)


class ArgumentHypergraph(BaseModel):
    passage_id: str
    source_text: Optional[str] = None
    nodes: list[PropositionNode] = Field(default_factory=list)
    support_hyperedges: list[SupportHyperedge] = Field(default_factory=list)
    rebutting_attacks: list[RebuttingAttack] = Field(default_factory=list)
    undercutting_attacks: list[UndercuttingAttack] = Field(default_factory=list)


class SpanGroundingError(ValueError):
    """Raised when a quote cannot be deterministically grounded in `source_text`."""


_CHAR_NORMALIZATION = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2014": "-",
    "\u2013": "-",
    "\u00a0": " ",
}


def _normalize_with_index_map(text: str) -> tuple[str, list[int]]:
    """Normalizes quotes/whitespace while preserving exact index mapping back to `text`."""
    norm_chars: list[str] = []
    orig_indices: list[int] = []
    prev_was_space = False

    for i, ch in enumerate(text):
        mapped = _CHAR_NORMALIZATION.get(ch, ch)
        if mapped.isspace():
            if not prev_was_space and norm_chars:
                norm_chars.append(" ")
                orig_indices.append(i)
            prev_was_space = True
        else:
            norm_chars.append(mapped)
            orig_indices.append(i)
            prev_was_space = False

    if norm_chars and norm_chars[-1] == " ":
        norm_chars.pop()
        orig_indices.pop()

    return "".join(norm_chars), orig_indices


def _find_all_occurrences(haystack: str, needle: str) -> list[int]:
    starts: list[int] = []
    pos = 0
    while True:
        idx = haystack.find(needle, pos)
        if idx == -1:
            break
        starts.append(idx)
        pos = idx + 1
    return starts


class DeterministicSpanGrounder:
    """Aligns LLM-extracted verbatim quotes to exact Rust-compatible Unicode character offsets.

    In Python, `str` indexing operates over Unicode scalar values (identical to Rust's `Vec<char>`
    indexing inside `atlas_core::model::ArgumentHypergraph::validate`).
    """

    @staticmethod
    def ground_quote(
        source_text: str,
        candidate_quote: str,
        hint_start: Optional[int] = None,
        allow_fuzzy: bool = True,
        min_fuzzy_ratio: float = 0.88,
    ) -> TextSpan:
        cleaned = candidate_quote.strip()
        if not cleaned:
            raise SpanGroundingError("Cannot ground an empty quote.")

        # 1. Exact substring match (disambiguating duplicates via hint_start if supplied).
        exact_hits = _find_all_occurrences(source_text, cleaned)
        if exact_hits:
            start = (
                min(exact_hits, key=lambda idx: abs(idx - hint_start))
                if hint_start is not None
                else exact_hits[0]
            )
            end = start + len(cleaned)
            return TextSpan(
                start_char=start,
                end_char=end,
                verbatim_quote=source_text[start:end],
            )

        # 2. Whitespace & smart-punctuation normalized exact alignment.
        norm_src, orig_map = _normalize_with_index_map(source_text)
        norm_quote, _ = _normalize_with_index_map(cleaned)
        if norm_quote:
            norm_hits = _find_all_occurrences(norm_src, norm_quote)
            if not norm_hits:
                norm_hits = _find_all_occurrences(norm_src.lower(), norm_quote.lower())
            if norm_hits:
                best_norm_start = (
                    min(norm_hits, key=lambda ni: abs(orig_map[ni] - hint_start))
                    if hint_start is not None
                    else norm_hits[0]
                )
                best_norm_end = best_norm_start + len(norm_quote) - 1
                orig_start = orig_map[best_norm_start]
                orig_end = orig_map[best_norm_end] + 1
                return TextSpan(
                    start_char=orig_start,
                    end_char=orig_end,
                    verbatim_quote=source_text[orig_start:orig_end],
                )

        # 3. Optional bounded fuzzy window match (guards against minor punctuation/word slips).
        if allow_fuzzy and len(norm_quote) >= 16:
            best_span = DeterministicSpanGrounder._fuzzy_window_align(
                source_text=source_text,
                norm_src=norm_src,
                orig_map=orig_map,
                norm_quote=norm_quote,
                min_fuzzy_ratio=min_fuzzy_ratio,
            )
            if best_span is not None:
                return best_span

        raise SpanGroundingError(
            f"Quote could not be grounded in source_text: {candidate_quote!r}"
        )

    @staticmethod
    def _fuzzy_window_align(
        source_text: str,
        norm_src: str,
        orig_map: list[int],
        norm_quote: str,
        min_fuzzy_ratio: float,
    ) -> Optional[TextSpan]:
        src_lower = norm_src.lower()
        q_lower = norm_quote.lower()
        q_len = len(q_lower)
        if len(src_lower) < q_len // 2:
            return None

        # Slide candidate start positions at word boundaries (or step=4 fallback).
        candidate_starts = [0] + [i + 1 for i, c in enumerate(src_lower) if c == " "]
        best_ratio = 0.0
        best_bounds: Optional[tuple[int, int]] = None

        min_win = max(12, int(q_len * 0.80))
        max_win = min(len(src_lower), int(q_len * 1.35) + 12)

        for s in candidate_starts:
            if s + min_win > len(src_lower):
                break
            # Quick character-bag lower bound before calling SequenceMatcher.
            probe = src_lower[s : min(len(src_lower), s + max_win)]
            matcher = difflib.SequenceMatcher(None, q_lower, probe, autojunk=False)
            if matcher.quick_ratio() < min_fuzzy_ratio * 0.70:
                continue
            blocks = matcher.get_matching_blocks()
            matched_chars = sum(b.size for b in blocks)
            # Determine tightest span in probe covering meaningful anchor blocks (>= 3 chars).
            anchor_blocks = [b for b in blocks if b.size >= 3] or [b for b in blocks if b.size > 0]
            if not anchor_blocks:
                continue
            local_start = s + anchor_blocks[0].b
            local_end = s + anchor_blocks[-1].b + anchor_blocks[-1].size
            window_text = src_lower[local_start:local_end]
            ratio = difflib.SequenceMatcher(None, q_lower, window_text, autojunk=False).ratio()
            coverage = matched_chars / max(1, q_len)
            if ratio >= min_fuzzy_ratio and coverage >= 0.80 and ratio > best_ratio:
                best_ratio = ratio
                best_bounds = (local_start, local_end)

        if best_bounds is None:
            return None

        ns, ne = best_bounds
        orig_start = orig_map[ns]
        orig_end = orig_map[ne - 1] + 1
        return TextSpan(
            start_char=orig_start,
            end_char=orig_end,
            verbatim_quote=source_text[orig_start:orig_end],
        )

    @staticmethod
    def ground_hypergraph(
        graph: ArgumentHypergraph,
        allow_fuzzy: bool = True,
    ) -> ArgumentHypergraph:
        """Verifies and repairs exact character offsets on all explicit nodes in `graph`."""
        if not graph.source_text:
            return graph

        grounded_nodes: list[PropositionNode] = []
        for node in graph.nodes:
            if node.node_type == NodeType.ENTHYMEME:
                grounded_nodes.append(node.model_copy(update={"span": None}))
                continue

            if node.span is None:
                raise SpanGroundingError(
                    f"Non-enthymeme node '{node.id}' ({node.node_type.value}) is missing a TextSpan."
                )

            # Fast path: already character-exact.
            s, e = node.span.start_char, node.span.end_char
            if (
                0 <= s < e <= len(graph.source_text)
                and graph.source_text[s:e] == node.span.verbatim_quote
            ):
                grounded_nodes.append(node)
                continue

            repaired = DeterministicSpanGrounder.ground_quote(
                source_text=graph.source_text,
                candidate_quote=node.span.verbatim_quote,
                hint_start=s,
                allow_fuzzy=allow_fuzzy,
            )
            grounded_nodes.append(node.model_copy(update={"span": repaired}))

        return graph.model_copy(update={"nodes": grounded_nodes})
