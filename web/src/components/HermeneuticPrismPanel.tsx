"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, GitCompareArrows } from "lucide-react";
import { alignGraphsStaticFallback, loadStaticCorpusBundle } from "@/lib/staticBundle";
import type {
  ArgumentHypergraph,
  HermeneuticLensDetail,
  HypergraphAlignmentReport,
  PassageDetail,
  PassageSummary,
  SolverReport,
} from "@/lib/types";

interface HermeneuticPrismPanelProps {
  passages: PassageSummary[];
  lenses: HermeneuticLensDetail[];
  currentWorkbenchGraph: ArgumentHypergraph | null;
  currentWorkbenchReport: SolverReport | null;
  onOpenInWorkbench: (graph: ArgumentHypergraph, report: SolverReport, argdown: string) => void;
}

const NODE_ROLE_LABELS: Record<string, string> = {
  thesis: "Thesis",
  explicit_premise: "Explicit",
  enthymeme: "Enthymeme",
  objection: "Objection",
  counterfactual_assumption: "Supposition",
};

function formatPassageTitle(filename: string): string {
  const stem = filename.replace(/\.argdown$/, "").replace(/^\d+_/, "");
  const parts = stem.split("_").filter(Boolean);
  if (parts.length === 0) return filename;
  const toTitle = (w: string) => w[0].toUpperCase() + w.slice(1);
  const author = toTitle(parts[0]);
  const subtitle = parts.slice(1).map(toTitle).join(" ");
  return subtitle ? `${author}: ${subtitle}` : author;
}

function formatScoreColor(val: number): string {
  if (val >= 0.8) return "var(--forest)";
  if (val >= 0.5) return "var(--cobalt)";
  return "var(--crimson)";
}

export function HermeneuticPrismPanel({
  passages,
  lenses,
  currentWorkbenchGraph,
  currentWorkbenchReport,
  onOpenInWorkbench,
}: HermeneuticPrismPanelProps) {
  const hasMatchingLensForCurrent = Boolean(
    currentWorkbenchGraph &&
      lenses.some((l) => l.target_passage_id === currentWorkbenchGraph.passage_id),
  );
  const defaultSourceA =
    currentWorkbenchGraph && hasMatchingLensForCurrent
      ? `workbench:${currentWorkbenchGraph.passage_id}`
      : passages.some((p) => p.passage_id === "dostoevsky-ivan-rebellion")
        ? "passage:dostoevsky-ivan-rebellion"
        : passages[0]
          ? `passage:${passages[0].passage_id}`
          : "";

  const [sourceAKey, setSourceAKey] = useState<string>(defaultSourceA);
  const [sourceBKey, setSourceBKey] = useState<string>("");
  const [threshold, setThreshold] = useState<number>(0.72);

  const [passageCache, setPassageCache] = useState<Record<string, PassageDetail>>({});
  const [graphA, setGraphA] = useState<ArgumentHypergraph | null>(currentWorkbenchGraph);
  const [reportA, setReportA] = useState<SolverReport | null>(currentWorkbenchReport);
  const [graphB, setGraphB] = useState<ArgumentHypergraph | null>(null);
  const [reportB, setReportB] = useState<SolverReport | null>(null);
  const [argdownB, setArgdownB] = useState<string>("");

  const [alignment, setAlignment] = useState<HypergraphAlignmentReport | null>(null);
  const [alignLoading, setAlignLoading] = useState<boolean>(false);
  const [alignError, setAlignError] = useState<string | null>(null);
  const alignAbortRef = useRef<AbortController | null>(null);

  // Sync default Reading A when workbench initially loads or user hasn't overridden it.
  useEffect(() => {
    if (!sourceAKey && currentWorkbenchGraph) {
      setSourceAKey(`workbench:${currentWorkbenchGraph.passage_id}`);
    }
  }, [sourceAKey, currentWorkbenchGraph]);

  // Keep Reading B automatically paired with a relevant Hermeneutic Lens whenever A changes.
  useEffect(() => {
    const activePassageId = sourceAKey.includes(":") ? sourceAKey.split(":")[1] : "";
    const matchedLens = lenses.find((l) => l.target_passage_id === activePassageId);
    if (matchedLens) {
      setSourceBKey(`lens:${matchedLens.lens_id}`);
      return;
    }
    setSourceBKey((prev) => {
      if (prev) return prev;
      if (lenses[0]) return `lens:${lenses[0].lens_id}`;
      if (passages[0]) return `passage:${passages[0].passage_id}`;
      return "";
    });
  }, [sourceAKey, lenses, passages]);

  async function resolveSelection(
    key: string,
  ): Promise<{ graph: ArgumentHypergraph; report: SolverReport; argdown: string } | null> {
    if (!key) return null;
    if (key.startsWith("workbench:")) {
      if (!currentWorkbenchGraph || !currentWorkbenchReport) return null;
      return {
        graph: currentWorkbenchGraph,
        report: currentWorkbenchReport,
        argdown: "",
      };
    }
    if (key.startsWith("lens:")) {
      const lensId = key.slice(5);
      const lens = lenses.find((l) => l.lens_id === lensId);
      if (!lens) return null;
      return { graph: lens.hypergraph, report: lens.report, argdown: lens.argdown };
    }
    if (key.startsWith("passage:")) {
      const pid = key.slice(8);
      if (passageCache[pid]) {
        const cached = passageCache[pid];
        return { graph: cached.hypergraph, report: cached.report, argdown: cached.argdown };
      }
      const detail = await fetch(`/api/passages/${encodeURIComponent(pid)}`, {
        signal: AbortSignal.timeout(2500),
      })
        .then((resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json() as Promise<PassageDetail>;
        })
        .catch(async () => {
          const bundle = await loadStaticCorpusBundle();
          const staticDetail = bundle.passage_details[pid];
          if (!staticDetail) throw new Error(`Failed to load passage '${pid}'`);
          return staticDetail;
        });
      setPassageCache((prev) => ({ ...prev, [pid]: detail }));
      return { graph: detail.hypergraph, report: detail.report, argdown: detail.argdown };
    }
    return null;
  }

  // Resolve graphs for A and B whenever selectors or cache inputs update.
  useEffect(() => {
    let cancelled = false;
    setAlignError(null);
    Promise.all([resolveSelection(sourceAKey), resolveSelection(sourceBKey)])
      .then(([resA, resB]) => {
        if (cancelled) return;
        setGraphA(resA?.graph ?? null);
        setReportA(resA?.report ?? null);
        setGraphB(resB?.graph ?? null);
        setReportB(resB?.report ?? null);
        setArgdownB(resB?.argdown ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          setAlignError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceAKey, sourceBKey, lenses, currentWorkbenchGraph, currentWorkbenchReport]);

  // Run Hungarian bipartite alignment whenever graphA, graphB, or threshold updates.
  useEffect(() => {
    if (!graphA || !graphB) return;
    alignAbortRef.current?.abort();
    const ctrl = new AbortController();
    alignAbortRef.current = ctrl;
    setAlignLoading(true);
    setAlignError(null);

    const compositeSignal = AbortSignal.any([ctrl.signal, AbortSignal.timeout(3000)]);

    fetch("/api/align", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: compositeSignal,
      body: JSON.stringify({
        graph_a: graphA,
        graph_b: graphB,
        similarity_threshold: threshold,
      }),
    })
      .then(async (resp) => {
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        return resp.json() as Promise<HypergraphAlignmentReport>;
      })
      .catch(async (err) => {
        if (ctrl.signal.aborted) throw err;
        return alignGraphsStaticFallback(graphA, graphB, threshold);
      })
      .then((data) => {
        if (!ctrl.signal.aborted) {
          setAlignment(data);
          setAlignLoading(false);
        }
      })
      .catch((err) => {
        if (!ctrl.signal.aborted && (err as Error).name !== "AbortError") {
          setAlignError(err instanceof Error ? err.message : String(err));
          setAlignLoading(false);
        }
      });

    return () => ctrl.abort();
  }, [graphA, graphB, threshold]);

  const nodesAById = useMemo(
    () => new Map((graphA?.nodes ?? []).map((n) => [n.id, n])),
    [graphA],
  );
  const nodesBById = useMemo(
    () => new Map((graphB?.nodes ?? []).map((n) => [n.id, n])),
    [graphB],
  );

  const thesisA = reportA?.thesis_id
    ? {
        id: reportA.thesis_id,
        score: reportA.gradual_df_quad.node_acceptability[reportA.thesis_id] ?? 0,
        label: reportA.dung_semantics.grounded_labels[reportA.thesis_id] ?? "undecided",
      }
    : null;

  const thesisB = reportB?.thesis_id
    ? {
        id: reportB.thesis_id,
        score: reportB.gradual_df_quad.node_acceptability[reportB.thesis_id] ?? 0,
        label: reportB.dung_semantics.grounded_labels[reportB.thesis_id] ?? "undecided",
      }
    : null;

  const metricCells = alignment
    ? [
        { label: "Consensus", value: alignment.consensus_score },
        { label: "Explicit Claims F1", value: alignment.explicit_node_prf.f1 },
        { label: "Enthymemes F1", value: alignment.enthymeme_prf.f1 },
        { label: "Support Gates F1", value: alignment.support_hyperedge_exact_prf.f1 },
        { label: "Rebuttals F1", value: alignment.rebuttal_prf.f1 },
        { label: "Undercutters F1", value: alignment.undercutter_prf.f1 },
      ]
    : [];

  return (
    <div
      style={{
        overflowY: "auto",
        blockSize: "100%",
        padding: "clamp(0.85rem, 3vw, 1.5rem)",
        background: "var(--paper-canvas)",
      }}
    >
      <div
        style={{
          maxInlineSize: "1200px",
          marginInline: "auto",
          display: "grid",
          gap: "1.15rem",
        }}
      >
        {/* Top Alignment Apparatus Bar */}
        <section
          aria-labelledby="prism-heading"
          style={{
            background: "var(--paper-reading)",
            border: "1px solid var(--rule-hairline)",
            borderRadius: "10px",
            padding: "1.15rem 1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.75rem",
              marginBlockEnd: "0.9rem",
            }}
          >
            <div>
              <h2
                id="prism-heading"
                style={{
                  margin: 0,
                  fontSize: "1.08rem",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.45rem",
                }}
              >
                <GitCompareArrows
                  size={17}
                  aria-hidden="true"
                  color="#1d4ed8"
                  style={{ flexShrink: 0 }}
                />
                Hermeneutic Prism: Interpretive Consensus &amp; Divergence
              </h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.84rem", color: "var(--ink-secondary)" }}>
                Compare two formal readings via BGE embeddings and Hungarian bipartite matching. Slide
                the cosine threshold to inspect where interpretations agree versus split.
              </p>
            </div>

            {graphB && reportB && (
              <button
                type="button"
                onClick={() => onOpenInWorkbench(graphB, reportB, argdownB)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  minBlockSize: "36px",
                  padding: "0.35rem 0.85rem",
                  borderRadius: "6px",
                  border: "1px solid var(--cobalt)",
                  background: "var(--paper-card)",
                  color: "var(--cobalt)",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                }}
              >
                Open Reading B in Workbench
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
              gap: "0.9rem",
              alignItems: "end",
            }}
          >
            <div>
              <label
                htmlFor="prism-reading-a"
                style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
              >
                Reading A (Reference Graph)
              </label>
              <select
                id="prism-reading-a"
                className="atlas-select"
                value={sourceAKey}
                onChange={(e) => setSourceAKey(e.target.value)}
                style={{ inlineSize: "100%" }}
              >
                {currentWorkbenchGraph && (
                  <option value={`workbench:${currentWorkbenchGraph.passage_id}`}>
                    Current Workbench ({currentWorkbenchGraph.passage_id})
                  </option>
                )}
                {passages.map((p) => (
                  <option key={p.passage_id} value={`passage:${p.passage_id}`}>
                    {formatPassageTitle(p.filename)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="prism-reading-b"
                style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
              >
                Reading B (Comparison Lens or Passage)
              </label>
              <select
                id="prism-reading-b"
                className="atlas-select"
                value={sourceBKey}
                onChange={(e) => setSourceBKey(e.target.value)}
                style={{ inlineSize: "100%" }}
              >
                {lenses.length > 0 && (
                  <optgroup label="Hermeneutic Lenses">
                    {lenses.map((l) => (
                      <option key={l.lens_id} value={`lens:${l.lens_id}`}>
                        {l.title} ({l.lens_id})
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Corpus Passages">
                  {passages.map((p) => (
                    <option key={p.passage_id} value={`passage:${p.passage_id}`}>
                      {formatPassageTitle(p.filename)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBlockEnd: "0.1rem",
                }}
              >
                <label
                  htmlFor="prism-threshold-slider"
                  style={{ fontSize: "0.8rem", fontWeight: 600 }}
                >
                  Cosine Similarity Threshold (&tau;)
                </label>
                <span className="tabular-data" style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--cobalt)" }}>
                  {threshold.toFixed(2)}
                </span>
              </div>
              <input
                id="prism-threshold-slider"
                type="range"
                min={0.45}
                max={0.95}
                step={0.01}
                value={threshold}
                aria-valuetext={`${Math.round(threshold * 100)} percent cosine similarity threshold`}
                className="atlas-slider"
                style={{ "--control-value": threshold, "--attr-min": 0.45, "--attr-max": 0.95 } as React.CSSProperties}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {sourceBKey.startsWith("lens:") && (
            <p
              style={{
                margin: "0.65rem 0 0",
                padding: "0.55rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid var(--rule-hairline)",
                background: "var(--paper-card)",
                fontSize: "0.82rem",
                color: "var(--ink-secondary)",
              }}
            >
              <strong>Lens note:</strong>{" "}
              {lenses.find((l) => `lens:${l.lens_id}` === sourceBKey)?.description}
            </p>
          )}
        </section>

        {alignError && (
          <div
            role="alert"
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              border: "1px solid var(--crimson-border)",
              background: "var(--crimson-soft)",
              color: "var(--crimson)",
              fontSize: "0.86rem",
            }}
          >
            {alignError}
          </div>
        )}

        {/* Consensus Scoreboard & Thesis Delta */}
        {alignment && (
          <section
            aria-label="Structural consensus metrics"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 155px), 1fr))",
              gap: "0.65rem",
            }}
          >
            {metricCells.map((cell) => (
              <div
                key={cell.label}
                style={{
                  padding: "0.7rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid var(--rule-hairline)",
                  background: "var(--paper-reading)",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", fontWeight: 600 }}>
                  {cell.label}
                </div>
                <div
                  className="tabular-data"
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 700,
                    color: formatScoreColor(cell.value),
                    marginBlockStart: "0.15rem",
                  }}
                >
                  {cell.value.toFixed(3)}
                </div>
              </div>
            ))}

            {thesisA && thesisB && (
              <div
                style={{
                  padding: "0.7rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid var(--rule-hairline)",
                  background: "var(--paper-reading)",
                }}
              >
                <div style={{ fontSize: "0.78rem", color: "var(--ink-secondary)", fontWeight: 600 }}>
                  Thesis Outcome Shift
                </div>
                <div
                  className="tabular-data"
                  style={{
                    fontSize: "0.86rem",
                    fontWeight: 700,
                    color:
                      Math.abs(thesisB.score - thesisA.score) > 0.2
                        ? "var(--crimson)"
                        : "var(--ink-primary)",
                    marginBlockStart: "0.25rem",
                  }}
                >
                  {thesisA.score.toFixed(2)} ({thesisA.label}) &rarr; {thesisB.score.toFixed(2)} ({thesisB.label})
                </div>
              </div>
            )}
          </section>
        )}

        {/* Accessible Responsive Pairwise Alignment Table */}
        <section
          aria-labelledby="prism-table-heading"
          style={{
            background: "var(--paper-reading)",
            border: "1px solid var(--rule-hairline)",
            borderRadius: "10px",
            padding: "1.15rem 1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              marginBlockEnd: "0.75rem",
            }}
          >
            <h3 id="prism-table-heading" style={{ margin: 0, fontSize: "0.98rem", fontWeight: 700 }}>
              Matched Propositions ({alignment?.matched_nodes.length ?? 0})
            </h3>
            {alignLoading && (
              <span style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                Aligning via BGE-small...
              </span>
            )}
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby="prism-table-heading"
            className="prism-table-wrap"
          >
            <table className="prism-table">
              <thead>
                <tr>
                  <th scope="col">Node Pair</th>
                  <th scope="col">Reading A Claim</th>
                  <th scope="col">Reading B Claim</th>
                  <th scope="col">Similarity &amp; Role</th>
                </tr>
              </thead>
              <tbody>
                {alignment && alignment.matched_nodes.length > 0 ? (
                  alignment.matched_nodes.map((m) => {
                    const nodeA = nodesAById.get(m.a_id);
                    const nodeB = nodesBById.get(m.b_id);
                    return (
                      <tr key={`${m.a_id}::${m.b_id}`}>
                        <th scope="row" className="tabular-data">
                          [{m.a_id}] &harr; [{m.b_id}]
                        </th>
                        <td>
                          <span className="prism-role-tag">
                            {NODE_ROLE_LABELS[m.a_type] ?? m.a_type}
                          </span>{" "}
                          {nodeA?.proposition ?? m.a_id}
                        </td>
                        <td>
                          <span className="prism-role-tag">
                            {NODE_ROLE_LABELS[m.b_type] ?? m.b_type}
                          </span>{" "}
                          {nodeB?.proposition ?? m.b_id}
                        </td>
                        <td className="tabular-data">
                          <strong>{m.similarity.toFixed(3)}</strong>{" "}
                          <span
                            style={{
                              fontSize: "0.76rem",
                              color: m.type_match ? "var(--forest)" : "var(--sienna)",
                            }}
                          >
                            {m.type_match ? "Same role" : "Role shift"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--ink-muted)", fontStyle: "italic" }}>
                      {alignLoading
                        ? "Computing semantic alignment..."
                        : "No node pairs clear the current cosine similarity threshold."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Unmatched Structural Divergences */}
        {alignment && (
          <section
            aria-label="Divergent unmatched claims"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
              gap: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--paper-reading)",
                border: "1px solid var(--rule-hairline)",
                borderRadius: "10px",
                padding: "1rem 1.15rem",
              }}
            >
              <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.94rem", fontWeight: 700 }}>
                Unique to Reading A ({alignment.unmatched_a_nodes.length})
              </h3>
              {alignment.unmatched_a_nodes.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--ink-muted)" }}>
                  Every node in Reading A aligned to a partner in Reading B.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
                  {alignment.unmatched_a_nodes.map((nid) => {
                    const n = nodesAById.get(nid);
                    return (
                      <li
                        key={nid}
                        style={{
                          padding: "0.6rem 0.75rem",
                          borderRadius: "8px",
                          border: "1px dashed var(--sienna)",
                          background: "var(--sienna-soft)",
                          fontSize: "0.84rem",
                        }}
                      >
                        <div className="tabular-data" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--sienna)" }}>
                          [{nid}] {n ? NODE_ROLE_LABELS[n.node_type] ?? n.node_type : ""}
                        </div>
                        <div style={{ marginBlockStart: "0.15rem" }}>{n?.proposition ?? nid}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div
              style={{
                background: "var(--paper-reading)",
                border: "1px solid var(--rule-hairline)",
                borderRadius: "10px",
                padding: "1rem 1.15rem",
              }}
            >
              <h3 style={{ margin: "0 0 0.6rem", fontSize: "0.94rem", fontWeight: 700 }}>
                Unique to Reading B ({alignment.unmatched_b_nodes.length})
              </h3>
              {alignment.unmatched_b_nodes.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--ink-muted)" }}>
                  Every node in Reading B aligned to a partner in Reading A.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
                  {alignment.unmatched_b_nodes.map((nid) => {
                    const n = nodesBById.get(nid);
                    return (
                      <li
                        key={nid}
                        style={{
                          padding: "0.6rem 0.75rem",
                          borderRadius: "8px",
                          border: "1px dashed var(--crimson)",
                          background: "var(--crimson-soft)",
                          fontSize: "0.84rem",
                        }}
                      >
                        <div className="tabular-data" style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--crimson)" }}>
                          [{nid}] {n ? NODE_ROLE_LABELS[n.node_type] ?? n.node_type : ""}
                        </div>
                        <div style={{ marginBlockStart: "0.15rem" }}>{n?.proposition ?? nid}</div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
