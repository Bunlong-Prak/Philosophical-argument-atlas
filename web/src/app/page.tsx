"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen } from "lucide-react";
import { ApparatusInspector } from "@/components/ApparatusInspector";
import { CustomLabPanel } from "@/components/CustomLabPanel";
import { HypergraphCanvas } from "@/components/HypergraphCanvas";
import { SourceReader } from "@/components/SourceReader";
import type {
  ArgumentHypergraph,
  PassageDetail,
  PassageSummary,
  SolverReport,
} from "@/lib/types";

type ActiveTab = "workbench" | "lab";
const DEFAULT_PASSAGE_ID = "dostoevsky-ivan-rebellion";

export default function WorkbenchPage() {
  const [passages, setPassages] = useState<PassageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PASSAGE_ID);
  const [originalGraph, setOriginalGraph] = useState<ArgumentHypergraph | null>(null);
  const [graph, setGraph] = useState<ArgumentHypergraph | null>(null);
  const [report, setReport] = useState<SolverReport | null>(null);
  const [argdownText, setArgdownText] = useState<string>("");
  const [tNorm, setTNorm] = useState<"godel" | "product">("godel");
  const [activeTab, setActiveTab] = useState<ActiveTab>("workbench");
  const [showEnthymemes, setShowEnthymemes] = useState<boolean>(true);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<string>("");

  const solveAbortRef = useRef<AbortController | null>(null);
  const workbenchTabRef = useRef<HTMLButtonElement | null>(null);
  const labTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/passages")
      .then((r) => {
        if (!r.ok) throw new Error(`Backend responded ${r.status}`);
        return r.json();
      })
      .then((list: PassageSummary[]) => {
        if (cancelled) return;
        setPassages(list);
        if (list.length > 0 && !list.some((p) => p.passage_id === DEFAULT_PASSAGE_ID)) {
          setSelectedId(list[0].passage_id);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            `Cannot reach FastAPI backend at /api (${err instanceof Error ? err.message : String(err)}). Ensure uvicorn is running on port 8000.`,
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    fetch(`/api/passages/${encodeURIComponent(selectedId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load passage '${selectedId}'`);
        return r.json();
      })
      .then((detail: PassageDetail) => {
        if (cancelled) return;
        setOriginalGraph(detail.hypergraph);
        setGraph(detail.hypergraph);
        setReport(detail.report);
        setArgdownText(detail.argdown);
        setHoveredNodeId(null);
        setSelectedNodeId(null);
        setTNorm("godel");
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const runLiveSolve = useCallback(
    async (nextGraph: ArgumentHypergraph, nextNorm: "godel" | "product") => {
      solveAbortRef.current?.abort();
      const ctrl = new AbortController();
      solveAbortRef.current = ctrl;

      try {
        const resp = await fetch("/api/solve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            hypergraph: nextGraph,
            strict_spans: Boolean(nextGraph.source_text),
            threshold: 0.5,
            t_norm: nextNorm,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || "Solve failed");
        }
        const nextReport: SolverReport = await resp.json();
        setReport(nextReport);
        if (nextReport.thesis_id) {
          const score = nextReport.gradual_df_quad.node_acceptability[nextReport.thesis_id];
          setLiveStatus(
            `Solved in ${nextReport.solve_time_microseconds} microseconds. Thesis ${nextReport.thesis_id} acceptability ${score.toFixed(2)}.`,
          );
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [],
  );

  const handleChangeCredence = useCallback(
    (nodeId: string, newCredence: number) => {
      if (!graph) return;
      const updated: ArgumentHypergraph = {
        ...graph,
        nodes: graph.nodes.map((n) =>
          n.id === nodeId ? { ...n, base_credence: newCredence } : n,
        ),
      };
      setGraph(updated);
      runLiveSolve(updated, tNorm);
    },
    [graph, tNorm, runLiveSolve],
  );

  const handleApplyKnockout = useCallback(
    (nodeIds: string[]) => {
      if (!graph) return;
      const dropSet = new Set(nodeIds);
      const updated: ArgumentHypergraph = {
        ...graph,
        nodes: graph.nodes.map((n) =>
          dropSet.has(n.id) ? { ...n, base_credence: 0.0 } : n,
        ),
      };
      setGraph(updated);
      runLiveSolve(updated, tNorm);
    },
    [graph, tNorm, runLiveSolve],
  );

  const handleResetAll = useCallback(() => {
    if (!originalGraph) return;
    setGraph(originalGraph);
    runLiveSolve(originalGraph, tNorm);
  }, [originalGraph, tNorm, runLiveSolve]);

  const handleChangeTNorm = useCallback(
    (norm: "godel" | "product") => {
      setTNorm(norm);
      if (graph) {
        runLiveSolve(graph, norm);
      }
    },
    [graph, runLiveSolve],
  );

  const activeNodeId = hoveredNodeId ?? selectedNodeId;

  const knockoutHighlightIds = useMemo(() => {
    if (!report || report.minimal_knockouts.length === 0) return new Set<string>();
    return new Set(report.minimal_knockouts[0].removed_node_ids);
  }, [report]);

  function handleTabKeyDown(e: React.KeyboardEvent, current: ActiveTab) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next: ActiveTab = current === "workbench" ? "lab" : "workbench";
      setActiveTab(next);
      if (next === "workbench") workbenchTabRef.current?.focus();
      else labTabRef.current?.focus();
    }
  }

  return (
    <div className="atlas-shell">
      <header className="atlas-header">
        <div className="atlas-brand-group">
          <h1 className="atlas-title">
            <BookOpen size={18} aria-hidden="true" color="#1d4ed8" />
            Argument Atlas
          </h1>

          <div className="atlas-passage-select-wrap">
            <label
              htmlFor="passage-select"
              style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--ink-secondary)" }}
            >
              Passage
            </label>
            <select
              id="passage-select"
              className="atlas-select"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setActiveTab("workbench");
              }}
            >
              {passages.map((p) => (
                <option key={p.passage_id} value={p.passage_id}>
                  {p.filename.replace(/\.argdown$/, "").replace(/_/g, " ")} ({p.node_count} nodes)
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav aria-label="Workspace modes">
          <div className="atlas-tablist" role="tablist" aria-label="Workbench Views">
            <button
              ref={workbenchTabRef}
              type="button"
              role="tab"
              id="tab-workbench"
              aria-selected={activeTab === "workbench"}
              className="atlas-tab"
              onClick={() => setActiveTab("workbench")}
              onKeyDown={(e) => handleTabKeyDown(e, "workbench")}
            >
              Dialectical Workbench
            </button>
            <button
              ref={labTabRef}
              type="button"
              role="tab"
              id="tab-lab"
              aria-selected={activeTab === "lab"}
              className="atlas-tab"
              onClick={() => setActiveTab("lab")}
              onKeyDown={(e) => handleTabKeyDown(e, "lab")}
            >
              Custom Text &amp; NLI Lab
            </button>
          </div>
        </nav>

        <div className="atlas-metrics-bar">
          {report && (
            <span className="atlas-latency-pill tabular-data">
              <Activity size={13} aria-hidden="true" color="#1d4ed8" />
              Rust solver: {report.solve_time_microseconds} &mu;s
            </span>
          )}
        </div>
      </header>

      <main style={{ minBlockSize: 0, blockSize: "100%", overflow: "hidden" }}>
        <div
          role="tabpanel"
          aria-labelledby="tab-workbench"
          hidden={activeTab !== "workbench"}
          style={{ blockSize: "100%" }}
        >
          {activeTab === "workbench" && (
            <>
              {errorMsg && (
                <div
                  role="alert"
                  style={{
                    margin: "1.5rem",
                    padding: "1rem",
                    borderRadius: "8px",
                    border: "1px solid var(--crimson-border)",
                    background: "var(--crimson-soft)",
                    color: "var(--crimson)",
                  }}
                >
                  {errorMsg}
                </div>
              )}

              {loading && !errorMsg && (
                <div style={{ padding: "2rem", color: "var(--ink-secondary)" }}>
                  Loading passage and running Rust formal solver...
                </div>
              )}

              {!loading && graph && originalGraph && report && (
                <div className="workbench-grid">
                  <SourceReader
                    graph={graph}
                    report={report}
                    argdownText={argdownText}
                    activeNodeId={activeNodeId}
                    showEnthymemes={showEnthymemes}
                    onToggleEnthymemes={() => setShowEnthymemes((v) => !v)}
                    onHoverNode={setHoveredNodeId}
                    onSelectNode={(id) =>
                      setSelectedNodeId((prev) => (prev === id ? null : id))
                    }
                  />
                  <HypergraphCanvas
                    graph={graph}
                    report={report}
                    showEnthymemes={showEnthymemes}
                    activeNodeId={activeNodeId}
                    knockoutHighlightIds={knockoutHighlightIds}
                    onHoverNode={setHoveredNodeId}
                    onSelectNode={(id) =>
                      setSelectedNodeId((prev) => (prev === id ? null : id))
                    }
                  />
                  <ApparatusInspector
                    graph={graph}
                    originalGraph={originalGraph}
                    report={report}
                    tNorm={tNorm}
                    activeNodeId={activeNodeId}
                    onChangeCredence={handleChangeCredence}
                    onApplyKnockout={handleApplyKnockout}
                    onResetAll={handleResetAll}
                    onChangeTNorm={handleChangeTNorm}
                    onHoverNode={setHoveredNodeId}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div
          role="tabpanel"
          aria-labelledby="tab-lab"
          hidden={activeTab !== "lab"}
          style={{ blockSize: "100%" }}
        >
          {activeTab === "lab" && (
            <CustomLabPanel
              onLoadExtractedGraph={(extractedGraph, extractedReport, nextArgdown) => {
                setOriginalGraph(extractedGraph);
                setGraph(extractedGraph);
                setReport(extractedReport);
                setArgdownText(nextArgdown ?? "");
                setHoveredNodeId(null);
                setSelectedNodeId(null);
                setTNorm("godel");
                setActiveTab("workbench");
              }}
            />
          )}
        </div>
      </main>

      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>
        {liveStatus}
      </div>
    </div>
  );
}
