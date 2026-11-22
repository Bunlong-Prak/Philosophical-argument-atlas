"use client";

import React, { useMemo } from "react";
import { Eye, EyeOff, FileText } from "lucide-react";
import type { ArgumentHypergraph, PropositionNode, SolverReport } from "@/lib/types";

interface SourceReaderProps {
  graph: ArgumentHypergraph;
  report: SolverReport;
  argdownText: string;
  activeNodeId: string | null;
  showEnthymemes: boolean;
  onToggleEnthymemes: () => void;
  onHoverNode: (id: string | null) => void;
  onSelectNode: (id: string) => void;
}

interface TextSegment {
  text: string;
  node: PropositionNode | null;
}

function formatPassageTitle(passageId: string): string {
  return passageId
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function buildTextSegments(sourceText: string, nodes: PropositionNode[]): TextSegment[] {
  const chars = Array.from(sourceText);
  const groundedNodes = nodes
    .filter((n) => n.span && n.span.start_char >= 0 && n.span.end_char <= chars.length)
    .sort((a, b) => {
      const sa = a.span!;
      const sb = b.span!;
      if (sa.start_char !== sb.start_char) return sa.start_char - sb.start_char;
      return sa.end_char - sa.start_char - (sb.end_char - sb.start_char);
    });

  // Partition into non-overlapping highlighted segments while preserving every character verbatim.
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const node of groundedNodes) {
    const span = node.span!;
    if (span.start_char < cursor) {
      // Skip partial overlaps safely without duplicating characters.
      continue;
    }
    if (span.start_char > cursor) {
      segments.push({
        text: chars.slice(cursor, span.start_char).join(""),
        node: null,
      });
    }
    segments.push({
      text: chars.slice(span.start_char, span.end_char).join(""),
      node,
    });
    cursor = span.end_char;
  }

  if (cursor < chars.length) {
    segments.push({
      text: chars.slice(cursor).join(""),
      node: null,
    });
  }

  return segments;
}

export function SourceReader({
  graph,
  report,
  argdownText,
  activeNodeId,
  showEnthymemes,
  onToggleEnthymemes,
  onHoverNode,
  onSelectNode,
}: SourceReaderProps) {
  const segments = useMemo(() => {
    if (!graph.source_text) return [];
    return buildTextSegments(graph.source_text, graph.nodes);
  }, [graph.source_text, graph.nodes]);

  const enthymemes = useMemo(
    () => graph.nodes.filter((n) => n.node_type === "enthymeme"),
    [graph.nodes],
  );

  const speakers = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (n.speaker) set.add(n.speaker);
    }
    return Array.from(set);
  }, [graph.nodes]);

  return (
    <section className="pane-reader" aria-labelledby="reader-heading">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBlockEnd: "0.75rem",
        }}
      >
        <h2
          id="reader-heading"
          style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, letterSpacing: "-0.015em" }}
        >
          {formatPassageTitle(graph.passage_id)}
        </h2>
        <button
          type="button"
          onClick={onToggleEnthymemes}
          aria-pressed={showEnthymemes}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            minBlockSize: "34px",
            padding: "0.3rem 0.7rem",
            borderRadius: "6px",
            border: `1px solid ${showEnthymemes ? "var(--sienna)" : "var(--rule-strong)"}`,
            background: showEnthymemes ? "var(--sienna-soft)" : "var(--paper-card)",
            color: showEnthymemes ? "var(--sienna)" : "var(--ink-secondary)",
            fontSize: "0.82rem",
            fontWeight: 600,
          }}
        >
          {showEnthymemes ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
          {showEnthymemes ? "Enthymemes Visible" : "Enthymemes Hidden"}
        </button>
      </div>

      {speakers.length > 0 && (
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.82rem",
            color: "var(--ink-muted)",
          }}
        >
          Voices: {speakers.join(", ")}
        </p>
      )}

      {graph.source_text ? (
        <p className="passage-prose">
          {segments.map((seg, i) => {
            if (!seg.node) {
              return <React.Fragment key={i}>{seg.text}</React.Fragment>;
            }
            const node = seg.node;
            const isActive = activeNodeId === node.id;
            return (
              <span
                key={`${node.id}-${i}`}
                role="button"
                tabIndex={0}
                className="span-highlight"
                data-role={node.node_type}
                data-active={isActive}
                onMouseEnter={() => onHoverNode(node.id)}
                onMouseLeave={() => onHoverNode(null)}
                onFocus={() => onHoverNode(node.id)}
                onBlur={() => onHoverNode(null)}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
                aria-pressed={isActive}
                aria-label={`Highlight proposition ${node.id}: ${node.proposition}`}
              >
                {seg.text}
                <sup
                  className="tabular-data"
                  style={{
                    fontSize: "0.68em",
                    fontWeight: 700,
                    marginInlineStart: "2px",
                    color: "var(--ink-secondary)",
                  }}
                >
                  [{node.id}]
                </sup>
              </span>
            );
          })}
        </p>
      ) : (
        <p style={{ color: "var(--ink-muted)", fontStyle: "italic" }}>
          No verbatim source passage attached to this graph.
        </p>
      )}

      <div
        style={{
          marginBlockStart: "1.5rem",
          paddingBlockStart: "1rem",
          borderBlockStart: "1px solid var(--rule-hairline)",
        }}
      >
        <h3 style={{ margin: "0 0 0.65rem", fontSize: "0.9rem", fontWeight: 700 }}>
          Unspoken Assumptions ({enthymemes.length})
        </h3>
        {enthymemes.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-muted)" }}>
            No implicit enthymemes in this graph.
          </p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
            {enthymemes.map((en) => {
              const post = report.gradual_df_quad.node_acceptability[en.id] ?? en.base_credence;
              const isActive = activeNodeId === en.id;
              return (
                <li key={en.id}>
                  <button
                    type="button"
                    onMouseEnter={() => onHoverNode(en.id)}
                    onMouseLeave={() => onHoverNode(null)}
                    onClick={() => onSelectNode(en.id)}
                    style={{
                      inlineSize: "100%",
                      textAlign: "start",
                      padding: "0.65rem 0.75rem",
                      borderRadius: "6px",
                      border: `1px dashed ${isActive ? "var(--cobalt)" : "var(--sienna)"}`,
                      background: isActive ? "var(--cobalt-soft)" : "var(--sienna-soft)",
                      display: "grid",
                      gap: "0.25rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        color: "var(--sienna)",
                      }}
                    >
                      <span className="tabular-data">[{en.id}] Implicit Assumption</span>
                      <span className="tabular-data">σ* = {post.toFixed(2)}</span>
                    </div>
                    <span style={{ fontSize: "0.87rem", color: "var(--ink-primary)" }}>
                      {en.proposition}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {argdownText && (
        <details style={{ marginBlockStart: "1.25rem" }}>
          <summary
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.84rem",
              fontWeight: 600,
              color: "var(--ink-secondary)",
              cursor: "pointer",
              minBlockSize: "32px",
            }}
          >
            <FileText size={14} aria-hidden="true" />
            Inspect .argdown source
          </summary>
          <pre
            className="tabular-data"
            style={{
              marginBlockStart: "0.5rem",
              padding: "0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--rule-hairline)",
              background: "var(--paper-rail)",
              fontSize: "0.75rem",
              lineHeight: 1.5,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {argdownText}
          </pre>
        </details>
      )}
    </section>
  );
}
