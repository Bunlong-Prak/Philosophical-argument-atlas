"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Check, Link2 } from "lucide-react";
import { ApparatusInspector } from "@/components/ApparatusInspector";
import { CustomLabPanel } from "@/components/CustomLabPanel";
import { HermeneuticPrismPanel } from "@/components/HermeneuticPrismPanel";
import { HypergraphCanvas } from "@/components/HypergraphCanvas";
import { SourceReader } from "@/components/SourceReader";
import { loadStaticCorpusBundle } from "@/lib/staticBundle";
import { getAtlasWasm, solveGraphWasm } from "@/lib/wasmSolver";
import type {
  ArgumentHypergraph,
  HermeneuticLensDetail,
  PassageDetail,
  PassageSummary,
  SolverReport,
} from "@/lib/types";

type ActiveTab = "workbench" | "prism" | "lab";
const DEFAULT_PASSAGE_ID = "dostoevsky-ivan-rebellion";

function formatPassageOption(filename: string, nodeCount: number): string {
  const stem = filename.replace(/\.argdown$/, "").replace(/^\d+_/, "");
  const parts = stem.split("_").filter(Boolean);
  if (parts.length === 0) return `${filename} (${nodeCount} nodes)`;
  const toTitle = (w: string) => w[0].toUpperCase() + w.slice(1);
  const author = toTitle(parts[0]);
  const subtitle = parts.slice(1).map(toTitle).join(" ");
  const title = subtitle ? `${author}: ${subtitle}` : author;
  return `${title} (${nodeCount} nodes)`;
}

function legacyClipboardCopy(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const field = Object.assign(document.createElement("textarea"), { value: text });
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;inset-block-start:0;opacity:0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export default function WorkbenchPage() {
  const [passages, setPassages] = useState<PassageSummary[]>([]);
  const [lenses, setLenses] = useState<HermeneuticLensDetail[]>([]);
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
  const [solverModeLabel, setSolverModeLabel] = useState<"Wasm" | "Rust">("Rust");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copyTipText, setCopyTipText] = useState<string>("");

  const solveAbortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCopyMsgRef = useRef<string>("");
  const pendingUrlStateRef = useRef<{
    norm?: "godel" | "product";
    credences?: Map<string, number>;
  } | null>(null);
  const workbenchTabRef = useRef<HTMLButtonElement | null>(null);
  const prismTabRef = useRef<HTMLButtonElement | null>(null);
  const labTabRef = useRef<HTMLButtonElement | null>(null);

  // Hydrate initial URL share parameters and pre-warm the in-browser Rust Wasm module.
  useEffect(() => {
    getAtlasWasm()
      .then(() => setSolverModeLabel("Wasm"))
      .catch(() => {});

    if (typeof window !== "undefined") {
      const params = new URL(window.location.href).searchParams;
      const urlPassage = params.get("passage");
      const urlTab = params.get("tab");
      const urlNorm = params.get("norm");
      const urlCreds = params.get("c");

      if (urlTab === "workbench" || urlTab === "prism" || urlTab === "lab") {
        setActiveTab(urlTab);
      }
      if (urlPassage) {
        setSelectedId(urlPassage);
      }
      const credMap = new Map<string, number>();
      if (urlCreds) {
        for (const pair of urlCreds.split(",")) {
          const [nid, rawVal] = pair.split(":");
          const parsed = Number(rawVal);
          if (nid && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
            credMap.set(nid, parsed);
          }
        }
      }
      if (urlNorm === "product" || urlNorm === "godel" || credMap.size > 0) {
        pendingUrlStateRef.current = {
          norm: urlNorm === "product" ? "product" : urlNorm === "godel" ? "godel" : undefined,
          credences: credMap.size > 0 ? credMap : undefined,
        };
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/passages", { signal: AbortSignal.timeout(2500) }).then((r) => {
        if (!r.ok) throw new Error(`Backend responded ${r.status}`);
        return r.json() as Promise<PassageSummary[]>;
      }),
      fetch("/api/hermeneutic-lenses", { signal: AbortSignal.timeout(2500) })
        .then((r) => (r.ok ? (r.json() as Promise<HermeneuticLensDetail[]>) : []))
        .catch(() => [] as HermeneuticLensDetail[]),
    ])
      .catch(async () => {
        const bundle = await loadStaticCorpusBundle();
        return [bundle.passages, bundle.lenses] as const;
      })
      .then(([list, lensList]) => {
        if (cancelled) return;
        setPassages(list);
        setLenses(lensList);
        setSelectedId((curr) => {
          if (curr === "__custom__" || list.some((p) => p.passage_id === curr)) {
            return curr;
          }
          return list[0]?.passage_id ?? DEFAULT_PASSAGE_ID;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            `Failed to load Argument Atlas corpus (${err instanceof Error ? err.message : String(err)}).`,
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === "__custom__") return;
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);

    fetch(`/api/passages/${encodeURIComponent(selectedId)}`, {
      signal: AbortSignal.timeout(2500),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PassageDetail>;
      })
      .catch(async () => {
        const bundle = await loadStaticCorpusBundle();
        const detail = bundle.passage_details[selectedId];
        if (!detail) {
          throw new Error(`Passage '${selectedId}' not found in corpus bundle.`);
        }
        return detail;
      })
      .then(async (detail: PassageDetail) => {
        if (cancelled) return;
        setOriginalGraph(detail.hypergraph);
        setArgdownText(detail.argdown);
        setHoveredNodeId(null);
        setSelectedNodeId(null);

        const pending = pendingUrlStateRef.current;
        pendingUrlStateRef.current = null;
        const appliedNorm = pending?.norm ?? "godel";
        setTNorm(appliedNorm);

        if (pending && (pending.credences || appliedNorm !== "godel")) {
          const patchedGraph: ArgumentHypergraph = pending.credences
            ? {
                ...detail.hypergraph,
                nodes: detail.hypergraph.nodes.map((n) =>
                  pending.credences!.has(n.id)
                    ? { ...n, base_credence: pending.credences!.get(n.id)! }
                    : n,
                ),
              }
            : detail.hypergraph;
          setGraph(patchedGraph);
          try {
            const wasmRep = await solveGraphWasm(patchedGraph, {
              strictSpans: Boolean(patchedGraph.source_text),
              threshold: 0.5,
              tNorm: appliedNorm,
            });
            if (!cancelled) {
              setSolverModeLabel("Wasm");
              setReport(wasmRep);
            }
          } catch {
            if (!cancelled) setReport(detail.report);
          }
        } else {
          setGraph(detail.hypergraph);
          setReport(detail.report);
        }
        if (!cancelled) setLoading(false);
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
      try {
        const wasmReport = await solveGraphWasm(nextGraph, {
          strictSpans: Boolean(nextGraph.source_text),
          threshold: 0.5,
          tNorm: nextNorm,
        });
        setSolverModeLabel("Wasm");
        setReport(wasmReport);
        if (wasmReport.thesis_id) {
          const score = wasmReport.gradual_df_quad.node_acceptability[wasmReport.thesis_id];
          setLiveStatus(
            `Solved via WebAssembly in ${wasmReport.solve_time_microseconds} microseconds. Thesis ${wasmReport.thesis_id} acceptability ${score.toFixed(2)}.`,
          );
        }
        return;
      } catch {
        // Fall back to FastAPI /api/solve if WebAssembly fails to initialize.
      }

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
        setSolverModeLabel("Rust");
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

  const handleCopyShareLink = useCallback(async () => {
    if (typeof window === "undefined") return;
    const shareUrl = new URL(window.location.href);
    shareUrl.search = "";
    if (selectedId && selectedId !== "__custom__") {
      shareUrl.searchParams.set("passage", selectedId);
    }
    if (activeTab !== "workbench") {
      shareUrl.searchParams.set("tab", activeTab);
    }
    if (tNorm !== "godel") {
      shareUrl.searchParams.set("norm", tNorm);
    }
    if (graph && originalGraph && selectedId !== "__custom__") {
      const origMap = new Map(originalGraph.nodes.map((n) => [n.id, n.base_credence]));
      const diffs: string[] = [];
      for (const n of graph.nodes) {
        const base = origMap.get(n.id);
        if (base !== undefined && Math.abs(base - n.base_credence) > 1e-4) {
          diffs.push(`${n.id}:${n.base_credence.toFixed(2)}`);
        }
      }
      if (diffs.length > 0) {
        shareUrl.searchParams.set("c", diffs.join(","));
      }
    }

    const urlStr = shareUrl.toString();
    window.history.replaceState(null, "", urlStr);

    let ok = false;
    try {
      await navigator.clipboard.writeText(urlStr);
      ok = true;
    } catch {
      ok = legacyClipboardCopy(urlStr);
    }

    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopyState("idle");
    setCopyTipText("");
    let message = ok ? "Copied" : "Copy failed";
    if (message === lastCopyMsgRef.current) {
      message += "\u00A0";
    }
    lastCopyMsgRef.current = message;

    requestAnimationFrame(() => {
      setCopyState(ok ? "copied" : "failed");
      setCopyTipText(message);
    });
    copyTimerRef.current = setTimeout(() => {
      setCopyState("idle");
      setCopyTipText("");
    }, 2000);
  }, [selectedId, activeTab, tNorm, graph, originalGraph]);

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
    const order: ActiveTab[] = ["workbench", "prism", "lab"];
    const idx = order.indexOf(current);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % order.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + order.length) % order.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = order.length - 1;

    if (nextIdx === null) return;
    e.preventDefault();
    const next = order[nextIdx];
    setActiveTab(next);
    if (next === "workbench") workbenchTabRef.current?.focus();
    else if (next === "prism") prismTabRef.current?.focus();
    else labTabRef.current?.focus();
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
              {selectedId === "__custom__" && graph && (
                <option value="__custom__">
                  Custom: {graph.passage_id} ({graph.nodes.length} nodes)
                </option>
              )}
              {passages.map((p) => (
                <option key={p.passage_id} value={p.passage_id}>
                  {formatPassageOption(p.filename, p.node_count)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="atlas-nav" aria-label="Workspace modes">
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
              ref={prismTabRef}
              type="button"
              role="tab"
              id="tab-prism"
              aria-selected={activeTab === "prism"}
              className="atlas-tab"
              onClick={() => setActiveTab("prism")}
              onKeyDown={(e) => handleTabKeyDown(e, "prism")}
            >
              Hermeneutic Prism
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
              {solverModeLabel} solver: {report.solve_time_microseconds} &mu;s
            </span>
          )}
          <span className="copy-share-wrap">
            <button
              type="button"
              className="copy-share-btn"
              onClick={handleCopyShareLink}
              data-copied={copyState === "copied" ? "" : undefined}
              data-failed={copyState === "failed" ? "" : undefined}
            >
              {copyState === "copied" ? (
                <Check size={14} aria-hidden="true" color="var(--forest)" />
              ) : (
                <Link2 size={14} aria-hidden="true" color="var(--cobalt)" />
              )}
              Share state
            </button>
            <span role="status" className="copy-status-tip">
              {copyTipText}
            </span>
          </span>
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
          aria-labelledby="tab-prism"
          hidden={activeTab !== "prism"}
          style={{ blockSize: "100%" }}
        >
          {activeTab === "prism" && (
            <HermeneuticPrismPanel
              passages={passages}
              lenses={lenses}
              currentWorkbenchGraph={graph}
              currentWorkbenchReport={report}
              onOpenInWorkbench={(nextGraph, nextReport, nextArgdown) => {
                setOriginalGraph(nextGraph);
                setGraph(nextGraph);
                setReport(nextReport);
                setArgdownText(nextArgdown);
                setSelectedId("__custom__");
                setHoveredNodeId(null);
                setSelectedNodeId(null);
                setTNorm("godel");
                setErrorMsg(null);
                setLoading(false);
                setActiveTab("workbench");
              }}
            />
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
                setSelectedId("__custom__");
                setHoveredNodeId(null);
                setSelectedNodeId(null);
                setTNorm("godel");
                setErrorMsg(null);
                setLoading(false);
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
