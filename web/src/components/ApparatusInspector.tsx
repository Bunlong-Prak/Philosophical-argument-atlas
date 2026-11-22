"use client";

import React from "react";
import { RotateCcw, Zap } from "lucide-react";
import type { ArgumentHypergraph, MinimalKnockout, SolverReport } from "@/lib/types";

interface ApparatusInspectorProps {
  graph: ArgumentHypergraph;
  originalGraph: ArgumentHypergraph;
  report: SolverReport;
  tNorm: "godel" | "product";
  activeNodeId: string | null;
  onChangeCredence: (nodeId: string, newCredence: number) => void;
  onApplyKnockout: (nodeIds: string[]) => void;
  onResetAll: () => void;
  onChangeTNorm: (norm: "godel" | "product") => void;
  onHoverNode: (id: string | null) => void;
}

export function ApparatusInspector({
  graph,
  originalGraph,
  report,
  tNorm,
  activeNodeId,
  onChangeCredence,
  onApplyKnockout,
  onResetAll,
  onChangeTNorm,
  onHoverNode,
}: ApparatusInspectorProps) {
  const derivedTargets = new Set(graph.support_hyperedges.map((e) => e.conclusion));
  const adjustableNodes = graph.nodes.filter(
    (n) => !derivedTargets.has(n.id) && n.node_type !== "thesis",
  );

  const originalById = new Map(originalGraph.nodes.map((n) => [n.id, n.base_credence]));
  const hasChanges = graph.nodes.some(
    (n) => Math.abs((originalById.get(n.id) ?? n.base_credence) - n.base_credence) > 1e-4,
  );

  const thesisId = report.thesis_id;
  const thesisScore = thesisId ? report.gradual_df_quad.node_acceptability[thesisId] : null;

  return (
    <aside className="pane-inspector" aria-labelledby="inspector-heading">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBlockEnd: "0.9rem",
        }}
      >
        <h2 id="inspector-heading" style={{ margin: 0, fontSize: "0.98rem", fontWeight: 700 }}>
          Assumption Sliders
        </h2>
        <button
          type="button"
          onClick={onResetAll}
          disabled={!hasChanges}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            minBlockSize: "32px",
            padding: "0.25rem 0.65rem",
            borderRadius: "6px",
            border: "1px solid var(--rule-strong)",
            background: hasChanges ? "var(--paper-card)" : "transparent",
            color: hasChanges ? "var(--ink-primary)" : "var(--ink-muted)",
            fontSize: "0.8rem",
            fontWeight: 600,
            opacity: hasChanges ? 1 : 0.6,
          }}
        >
          <RotateCcw size={13} aria-hidden="true" />
          Reset
        </button>
      </div>

      {thesisId && thesisScore !== null && (
        <div
          style={{
            padding: "0.7rem 0.8rem",
            borderRadius: "8px",
            border: `1.5px solid ${thesisScore <= 0.5 ? "var(--crimson-border)" : "var(--cobalt-border)"}`,
            background: thesisScore <= 0.5 ? "var(--crimson-soft)" : "var(--cobalt-soft)",
            marginBlockEnd: "1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: "0.82rem",
              fontWeight: 600,
              color: thesisScore <= 0.5 ? "var(--crimson)" : "var(--cobalt)",
            }}
          >
            <span>Target Thesis [{thesisId}]</span>
            <span className="tabular-data" style={{ fontSize: "1.05rem", fontWeight: 700 }}>
              {thesisScore.toFixed(4)}
            </span>
          </div>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.76rem", color: "var(--ink-secondary)" }}>
            Dung Grounded status:{" "}
            <strong className="tabular-data">
              {report.dung_semantics.grounded_labels[thesisId] ?? "undecided"}
            </strong>
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: "0.65rem", marginBlockEnd: "1.25rem" }}>
        {adjustableNodes.map((node) => {
          const isEnth = node.node_type === "enthymeme";
          const isObj = node.node_type === "objection";
          const sliderKind = isEnth ? "enthymeme" : isObj ? "objection" : "premise";
          const isActive = activeNodeId === node.id;
          const sliderId = `credence-slider-${node.id}`;

          return (
            <div
              key={node.id}
              onMouseEnter={() => onHoverNode(node.id)}
              onMouseLeave={() => onHoverNode(null)}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "8px",
                border: `1px solid ${isActive ? "var(--cobalt)" : "var(--rule-hairline)"}`,
                background: "var(--paper-reading)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "0.4rem",
                }}
              >
                <label
                  htmlFor={sliderId}
                  className="tabular-data"
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: isEnth
                      ? "var(--sienna)"
                      : isObj
                        ? "var(--crimson)"
                        : "var(--cobalt)",
                  }}
                >
                  [{node.id}] {isEnth ? "Enthymeme" : isObj ? "Objection" : "Premise"}
                </label>
                <span className="tabular-data" style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                  {node.base_credence.toFixed(2)}
                </span>
              </div>
              <p
                style={{
                  margin: "0.2rem 0 0.25rem",
                  fontSize: "0.78rem",
                  color: "var(--ink-secondary)",
                  lineHeight: 1.35,
                }}
              >
                {node.proposition}
              </p>
              <input
                id={sliderId}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={node.base_credence}
                aria-valuetext={`${Math.round(node.base_credence * 100)} percent credence`}
                data-kind={sliderKind}
                className="atlas-slider"
                style={{ "--control-value": node.base_credence } as React.CSSProperties}
                onChange={(e) => onChangeCredence(node.id, parseFloat(e.target.value))}
              />
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginBlockEnd: "1.25rem",
          paddingBlockStart: "0.9rem",
          borderBlockStart: "1px solid var(--rule-hairline)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBlockEnd: "0.5rem",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700 }}>
            Minimal Knockouts (Threshold &le; 0.50)
          </h3>
        </div>

        {report.minimal_knockouts.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-muted)" }}>
            {thesisScore !== null && thesisScore <= 0.5
              ? "Target thesis is already collapsed or deadlocked at <= 0.50."
              : "No premise subset of size <= 4 collapses the thesis."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {report.minimal_knockouts.map((ko: MinimalKnockout, idx: number) => (
              <div
                key={ko.removed_node_ids.join("+")}
                style={{
                  padding: "0.6rem 0.7rem",
                  borderRadius: "8px",
                  border: "1px solid var(--crimson-border)",
                  background: "var(--crimson-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                }}
              >
                <div style={{ minInlineSize: 0 }}>
                  <div
                    className="tabular-data"
                    style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--crimson)" }}
                  >
                    #{idx + 1} Drop [{ko.removed_node_ids.join(", ")}]
                  </div>
                  <div className="tabular-data" style={{ fontSize: "0.73rem", color: "#7f1d1d" }}>
                    cost {ko.credence_cost.toFixed(2)} &rarr; {ko.post_knockout_acceptability.toFixed(3)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onApplyKnockout(ko.removed_node_ids)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    minBlockSize: "30px",
                    padding: "0.2rem 0.55rem",
                    borderRadius: "6px",
                    border: "1px solid var(--crimson)",
                    background: "#ffffff",
                    color: "var(--crimson)",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  <Zap size={12} aria-hidden="true" />
                  Test
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          paddingBlockStart: "0.9rem",
          borderBlockStart: "1px solid var(--rule-hairline)",
          display: "grid",
          gap: "0.65rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <label htmlFor="tnorm-select" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
            Conjunction T-Norm
          </label>
          <select
            id="tnorm-select"
            className="atlas-select"
            value={tNorm}
            onChange={(e) => onChangeTNorm(e.target.value as "godel" | "product")}
            style={{ minBlockSize: "30px", fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
          >
            <option value="godel">Gödel min</option>
            <option value="product">Product</option>
          </select>
        </div>

        <div>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.84rem", fontWeight: 700 }}>
            Dung Extensions ({report.dung_semantics.preferred.length} Preferred)
          </h3>
          <div
            className="tabular-data"
            style={{
              padding: "0.55rem 0.65rem",
              borderRadius: "6px",
              border: "1px solid var(--rule-hairline)",
              background: "var(--paper-reading)",
              fontSize: "0.74rem",
              display: "grid",
              gap: "0.3rem",
            }}
          >
            <div>
              <strong>Grounded:</strong>{" "}
              {report.dung_semantics.grounded.length > 0
                ? report.dung_semantics.grounded.join(", ")
                : "∅ (empty)"}
            </div>
            <div>
              <strong>Preferred:</strong>{" "}
              {report.dung_semantics.preferred
                .map((ext) => `{${ext.join(", ")}}`)
                .join(" | ")}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
