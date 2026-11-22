"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { ArgumentHypergraph, SolverReport } from "@/lib/types";
import {
  buildFlowElements,
  computeLayeredPositions,
  getTopologyKey,
  type GateFlowNodeData,
  type PropFlowNodeData,
} from "@/lib/elkLayout";

interface HypergraphCanvasProps {
  graph: ArgumentHypergraph;
  report: SolverReport;
  showEnthymemes: boolean;
  activeNodeId: string | null;
  knockoutHighlightIds: Set<string>;
  onHoverNode: (id: string | null) => void;
  onSelectNode: (id: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  thesis: "Thesis",
  explicit_premise: "Explicit Premise",
  enthymeme: "Hidden Assumption",
  objection: "Objection",
  counterfactual_assumption: "Supposition",
};

function PropositionNodeCard({ data }: NodeProps<Node<PropFlowNodeData>>) {
  const { node, acceptability, dungLabel, isHovered, isSelected, isKnockoutHighlighted } = data;
  const isEnthymeme = node.node_type === "enthymeme";
  const isThesis = node.node_type === "thesis";
  const isObjection = node.node_type === "objection";
  const isCollapsed = acceptability <= 0.08;

  let borderColor = "#c8c2b4";
  let background = "#ffffff";
  let accentColor = "var(--cobalt)";

  if (isEnthymeme) {
    borderColor = "#b45309";
    background = "#fffbeb";
    accentColor = "var(--sienna)";
  } else if (isThesis) {
    borderColor = isCollapsed ? "#b91c1c" : "#1d4ed8";
    background = isCollapsed ? "#fef2f2" : "#ffffff";
    accentColor = isCollapsed ? "var(--crimson)" : "var(--cobalt)";
  } else if (isObjection) {
    borderColor = "#b91c1c";
    background = "#fef2f2";
    accentColor = "var(--crimson)";
  }

  if (isKnockoutHighlighted) {
    borderColor = "#b91c1c";
  } else if (isHovered || isSelected) {
    borderColor = "#1d4ed8";
  }

  const dungColors: Record<string, { bg: string; text: string }> = {
    in: { bg: "#dcfce7", text: "#166534" },
    out: { bg: "#fee2e2", text: "#991b1b" },
    undecided: { bg: "#fef3c7", text: "#92400e" },
  };
  const dStyle = dungColors[dungLabel] ?? dungColors.undecided;

  return (
    <div
      className="graph-node-card"
      style={{
        inlineSize: "276px",
        padding: "10px 12px",
        borderRadius: "8px",
        borderStyle: isEnthymeme ? "dashed" : "solid",
        borderWidth: isThesis || isHovered || isSelected || isKnockoutHighlighted ? "2px" : "1.5px",
        borderColor,
        background,
        opacity: isCollapsed && !isHovered && !isThesis ? 0.62 : 1,
        boxShadow:
          isHovered || isSelected
            ? "0 6px 18px rgba(29, 78, 216, 0.16)"
            : isKnockoutHighlighted
              ? "0 4px 14px rgba(185, 28, 28, 0.2)"
              : "0 2px 6px rgba(26, 29, 36, 0.06)",
      }}
    >
      <Handle
        type="target"
        position={Position.Bottom}
        style={{ background: accentColor, width: 8, height: 8, border: "1.5px solid #fff" }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.4rem",
          marginBlockEnd: "4px",
          fontSize: "11px",
        }}
      >
        <span className="tabular-data" style={{ fontWeight: 700, color: accentColor }}>
          [{node.id}] {ROLE_LABELS[node.node_type] ?? node.node_type}
        </span>
        <span
          style={{
            padding: "1px 6px",
            borderRadius: "999px",
            background: dStyle.bg,
            color: dStyle.text,
            fontWeight: 600,
            fontSize: "10px",
            textTransform: "uppercase",
          }}
        >
          {dungLabel}
        </span>
      </div>

      <p
        style={{
          margin: "0 0 8px",
          fontSize: "12.5px",
          lineHeight: 1.4,
          color: "var(--ink-primary)",
        }}
      >
        {node.proposition}
      </p>

      <div style={{ display: "grid", gap: "3px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11px",
            color: "var(--ink-secondary)",
          }}
        >
          <span>{node.speaker ?? "Primary text"}</span>
          <span className="tabular-data" style={{ fontWeight: 700, color: accentColor }}>
            σ* = {acceptability.toFixed(3)}
          </span>
        </div>
        <div
          style={{
            blockSize: "4px",
            borderRadius: "999px",
            background: "#e5e0d5",
            overflow: "hidden",
          }}
        >
          <div
            className="acceptability-fill"
            style={{
              blockSize: "100%",
              inlineSize: `${Math.round(acceptability * 100)}%`,
              background: accentColor,
            }}
          />
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Top}
        style={{ background: accentColor, width: 8, height: 8, border: "1.5px solid #fff" }}
      />
    </div>
  );
}

function InferenceGateNode({ data }: NodeProps<Node<GateFlowNodeData>>) {
  const { hyperedge, transmission, isSevered, isUndercut } = data;
  const schemeText =
    typeof hyperedge.scheme === "string"
      ? hyperedge.scheme.replace(/_/g, " ")
      : "inference";

  return (
    <div
      className="inference-gate-card"
      style={{
        inlineSize: "152px",
        minBlockSize: "44px",
        padding: "5px 10px",
        borderRadius: "999px",
        borderStyle: isSevered || isUndercut ? "dashed" : "solid",
        borderWidth: "1.5px",
        borderColor: isUndercut || isSevered ? "#b45309" : "#1d4ed8",
        background: isUndercut || isSevered ? "#fffbeb" : "#eff6ff",
        color: isUndercut || isSevered ? "#92400e" : "#1e40af",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        boxShadow: "0 1px 4px rgba(26, 29, 36, 0.07)",
      }}
    >
      <Handle
        type="target"
        position={Position.Bottom}
        style={{
          background: isUndercut || isSevered ? "#b45309" : "#1d4ed8",
          width: 7,
          height: 7,
        }}
      />
      <span className="tabular-data" style={{ fontSize: "11px", fontWeight: 700 }}>
        &lt;{hyperedge.id}&gt; {isSevered ? "SEVERED" : `τ=${transmission.toFixed(2)}`}
      </span>
      <span style={{ fontSize: "9.5px", opacity: 0.85, textTransform: "capitalize" }}>
        {schemeText}
      </span>
      <Handle
        type="source"
        position={Position.Top}
        style={{
          background: isSevered ? "#94a3b8" : "#1d4ed8",
          width: 7,
          height: 7,
        }}
      />
    </div>
  );
}

const nodeTypes = {
  proposition: PropositionNodeCard,
  inferenceGate: InferenceGateNode,
};

function CanvasResizeFit({
  containerRef,
  reduceMotion,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  reduceMotion: boolean;
}) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (!nodesInitialized) return;
    const timer = setTimeout(() => {
      fitView({ padding: "6%", duration: 0 });
    }, 30);
    return () => clearTimeout(timer);
  }, [nodesInitialized, fitView]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fitView({ padding: "6%", duration: reduceMotion ? 0 : 100 });
      }, 60);
    });
    obs.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      obs.disconnect();
    };
  }, [containerRef, fitView, reduceMotion]);

  return null;
}

export function HypergraphCanvas({
  graph,
  report,
  showEnthymemes,
  activeNodeId,
  knockoutHighlightIds,
  onHoverNode,
  onSelectNode,
}: HypergraphCanvasProps) {
  const topologyKey = useMemo(() => getTopologyKey(graph), [graph]);
  const [layoutState, setLayoutState] = useState<{
    key: string;
    positions: Record<string, { x: number; y: number }>;
  }>({ key: "", positions: {} });
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const handler = (ev: MediaQueryListEvent) => setReduceMotion(ev.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (layoutState.key === topologyKey && Object.keys(layoutState.positions).length > 0) {
      return;
    }
    computeLayeredPositions(graph).then((pos) => {
      if (!cancelled) {
        setLayoutState({ key: topologyKey, positions: pos });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [graph, topologyKey, layoutState.key, layoutState.positions]);

  const isLayoutReady =
    layoutState.key === topologyKey && Object.keys(layoutState.positions).length > 0;

  const { nodes, edges } = useMemo(() => {
    if (!isLayoutReady) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }
    const built = buildFlowElements({
      graph,
      report,
      positions: layoutState.positions,
      showEnthymemes,
      activeNodeId,
      knockoutHighlightIds,
    });
    if (reduceMotion) {
      return {
        nodes: built.nodes,
        edges: built.edges.map((e) => ({ ...e, animated: false })),
      };
    }
    return built;
  }, [
    isLayoutReady,
    graph,
    report,
    layoutState.positions,
    showEnthymemes,
    activeNodeId,
    knockoutHighlightIds,
    reduceMotion,
  ]);

  const handleNodeMouseEnter = (_: React.MouseEvent, node: Node) => {
    if (node.id.startsWith("prop:")) {
      onHoverNode(node.id.slice(5));
    }
  };

  const handleNodeMouseLeave = () => {
    onHoverNode(null);
  };

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    if (node.id.startsWith("prop:")) {
      onSelectNode(node.id.slice(5));
    }
  };

  return (
    <section className="pane-canvas" aria-label="Interactive Bipolar Argumentation Hypergraph">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem 1rem",
          padding: "0.45rem 0.9rem",
          borderBlockEnd: "1px solid var(--rule-hairline)",
          background: "var(--paper-reading)",
          fontSize: "0.76rem",
          color: "var(--ink-secondary)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ inlineSize: 14, blockSize: 2, background: "#1d4ed8" }} /> Support
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span
              style={{ inlineSize: 14, blockSize: 0, borderBlockStart: "2px dashed #b45309" }}
            />
            Enthymeme / Undercuts
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ inlineSize: 14, blockSize: 2, background: "#b91c1c" }} /> Rebuts
          </span>
        </div>
        <span style={{ color: "var(--ink-muted)", fontSize: "0.73rem" }}>
          Hover or click any node to locate its span
        </span>
      </div>

      <div ref={canvasWrapRef} style={{ position: "relative", flex: 1, minBlockSize: 0 }}>
        {!isLayoutReady ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              blockSize: "100%",
              color: "var(--ink-muted)",
              fontSize: "0.88rem",
            }}
          >
            Laying out bipolar hypergraph layers...
          </div>
        ) : (
          <ReactFlow
            key={topologyKey}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            onNodeClick={handleNodeClick}
            fitView
            fitViewOptions={{ padding: "6%" }}
            minZoom={0.2}
            maxZoom={1.15}
            nodesDraggable={false}
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <CanvasResizeFit containerRef={canvasWrapRef} reduceMotion={reduceMotion} />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#cdc7b8" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </section>
  );
}
