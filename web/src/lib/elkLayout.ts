import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ArgumentHypergraph, PropositionNode, SolverReport, SupportHyperedge } from "./types";

const elk = new ELK();

export interface PropFlowNodeData extends Record<string, unknown> {
  node: PropositionNode;
  acceptability: number;
  dungLabel: "in" | "out" | "undecided";
  isHovered: boolean;
  isSelected: boolean;
  isKnockoutHighlighted: boolean;
}

export interface GateFlowNodeData extends Record<string, unknown> {
  hyperedge: SupportHyperedge;
  transmission: number;
  isSevered: boolean;
  isUndercut: boolean;
}

const PROP_WIDTH = 272;
const PROP_HEIGHT = 128;
const GATE_WIDTH = 152;
const GATE_HEIGHT = 44;

export function getTopologyKey(graph: ArgumentHypergraph): string {
  const nKey = graph.nodes.map((n) => n.id).join(",");
  const sKey = graph.support_hyperedges
    .map((e) => `${e.id}:${e.premises.join("&")}->${e.conclusion}`)
    .join(";");
  const rKey = graph.rebutting_attacks.map((r) => `${r.id}:${r.attacker}->${r.target}`).join(";");
  const uKey = graph.undercutting_attacks
    .map((u) => `${u.id}:${u.attacker}->${u.target_hyperedge}`)
    .join(";");
  return `${graph.passage_id}|${nKey}|${sKey}|${rKey}|${uKey}`;
}

export async function computeLayeredPositions(
  graph: ArgumentHypergraph,
): Promise<Record<string, { x: number; y: number }>> {
  const children = [
    ...graph.nodes.map((n) => ({
      id: `prop:${n.id}`,
      width: PROP_WIDTH,
      height: PROP_HEIGHT,
    })),
    ...graph.support_hyperedges.map((e) => ({
      id: `gate:${e.id}`,
      width: GATE_WIDTH,
      height: GATE_HEIGHT,
    })),
  ];

  const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];

  for (const e of graph.support_hyperedges) {
    for (const p of e.premises) {
      edges.push({
        id: `elk-in-${e.id}-${p}`,
        sources: [`prop:${p}`],
        targets: [`gate:${e.id}`],
      });
    }
    edges.push({
      id: `elk-out-${e.id}`,
      sources: [`gate:${e.id}`],
      targets: [`prop:${e.conclusion}`],
    });
  }

  for (const r of graph.rebutting_attacks) {
    edges.push({
      id: `elk-reb-${r.id}`,
      sources: [`prop:${r.attacker}`],
      targets: [`prop:${r.target}`],
    });
  }

  for (const u of graph.undercutting_attacks) {
    edges.push({
      id: `elk-und-${u.id}`,
      sources: [`prop:${u.attacker}`],
      targets: [`gate:${u.target_hyperedge}`],
    });
  }

  const laidOut = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "UP",
      "elk.spacing.nodeNode": "44",
      "elk.layered.spacing.nodeNodeBetweenLayers": "58",
      "elk.edgeRouting": "SPLINES",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children,
    edges,
  });

  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of laidOut.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}

export function buildFlowElements(params: {
  graph: ArgumentHypergraph;
  report: SolverReport;
  positions: Record<string, { x: number; y: number }>;
  showEnthymemes: boolean;
  activeNodeId: string | null;
  knockoutHighlightIds: Set<string>;
}): { nodes: Node[]; edges: Edge[] } {
  const { graph, report, positions, showEnthymemes, activeNodeId, knockoutHighlightIds } = params;
  const visibleNodes = showEnthymemes
    ? graph.nodes
    : graph.nodes.filter((n) => n.node_type !== "enthymeme");
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  const undercutsByGate = new Map<string, number>();
  for (const und of graph.undercutting_attacks) {
    const score = report.gradual_df_quad.node_acceptability[und.attacker] ?? 0;
    const prev = undercutsByGate.get(und.target_hyperedge) ?? 0;
    undercutsByGate.set(und.target_hyperedge, Math.max(prev, score * und.weight));
  }

  const flowNodes: Node[] = [];

  for (const n of visibleNodes) {
    const pos = positions[`prop:${n.id}`] ?? { x: 0, y: 0 };
    const acc = report.gradual_df_quad.node_acceptability[n.id] ?? n.base_credence;
    const dungLabel = report.dung_semantics.grounded_labels[n.id] ?? "undecided";
    flowNodes.push({
      id: `prop:${n.id}`,
      type: "proposition",
      position: pos,
      data: {
        node: n,
        acceptability: acc,
        dungLabel,
        isHovered: activeNodeId === n.id,
        isSelected: activeNodeId === n.id,
        isKnockoutHighlighted: knockoutHighlightIds.has(n.id),
      } satisfies PropFlowNodeData,
    });
  }

  for (const e of graph.support_hyperedges) {
    const pos = positions[`gate:${e.id}`] ?? { x: 0, y: 0 };
    const tau = report.gradual_df_quad.hyperedge_transmission[e.id] ?? 0;
    const isSevered = tau <= 0.05;
    const isUndercut = (undercutsByGate.get(e.id) ?? 0) >= 0.35;

    flowNodes.push({
      id: `gate:${e.id}`,
      type: "inferenceGate",
      position: pos,
      data: {
        hyperedge: e,
        transmission: tau,
        isSevered,
        isUndercut,
      } satisfies GateFlowNodeData,
    });
  }

  const flowEdges: Edge[] = [];

  for (const e of graph.support_hyperedges) {
    const tau = report.gradual_df_quad.hyperedge_transmission[e.id] ?? 0;
    const gateSevered = tau <= 0.05;

    for (const p of e.premises) {
      if (!visibleIds.has(p)) continue;
      const pNode = graph.nodes.find((x) => x.id === p);
      const pScore = report.gradual_df_quad.node_acceptability[p] ?? 0;
      const premiseCollapsed = pScore <= 0.05;
      const isEnth = pNode?.node_type === "enthymeme";
      const stroke = premiseCollapsed || gateSevered ? "#94a3b8" : isEnth ? "#b45309" : "#1d4ed8";

      flowEdges.push({
        id: `sup-in-${e.id}-${p}`,
        source: `prop:${p}`,
        target: `gate:${e.id}`,
        type: "smoothstep",
        animated: !premiseCollapsed && !gateSevered && tau >= 0.5,
        style: {
          stroke,
          strokeWidth: premiseCollapsed ? 1.5 : 2.2,
          strokeDasharray: premiseCollapsed || isEnth ? "6 4" : undefined,
          opacity: premiseCollapsed ? 0.55 : 0.92,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      });
    }

    if (visibleIds.has(e.conclusion)) {
      const stroke = gateSevered ? "#94a3b8" : "#1d4ed8";
      flowEdges.push({
        id: `sup-out-${e.id}`,
        source: `gate:${e.id}`,
        target: `prop:${e.conclusion}`,
        type: "smoothstep",
        animated: !gateSevered && tau >= 0.5,
        style: {
          stroke,
          strokeWidth: gateSevered ? 1.5 : 2.6,
          strokeDasharray: gateSevered ? "6 4" : undefined,
          opacity: gateSevered ? 0.55 : 0.95,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      });
    }
  }

  for (const r of graph.rebutting_attacks) {
    if (!visibleIds.has(r.attacker) || !visibleIds.has(r.target)) continue;
    const attScore = report.gradual_df_quad.node_acceptability[r.attacker] ?? 0;
    const inactive = attScore <= 0.05;
    const stroke = inactive ? "#cbd5e1" : "#b91c1c";

    flowEdges.push({
      id: `reb-${r.id}`,
      source: `prop:${r.attacker}`,
      target: `prop:${r.target}`,
      type: "smoothstep",
      label: "rebuts",
      labelStyle: { fontSize: 10, fill: inactive ? "#64748b" : "#991b1b", fontWeight: 600 },
      labelBgStyle: { fill: "#faf8f4", fillOpacity: 0.9 },
      style: {
        stroke,
        strokeWidth: inactive ? 1.4 : 2.4,
        strokeDasharray: inactive ? "4 4" : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
    });
  }

  for (const u of graph.undercutting_attacks) {
    if (!visibleIds.has(u.attacker)) continue;
    const attScore = report.gradual_df_quad.node_acceptability[u.attacker] ?? 0;
    const inactive = attScore <= 0.05;
    const stroke = inactive ? "#cbd5e1" : "#b45309";

    flowEdges.push({
      id: `und-${u.id}`,
      source: `prop:${u.attacker}`,
      target: `gate:${u.target_hyperedge}`,
      type: "smoothstep",
      label: "undercuts",
      labelStyle: { fontSize: 10, fill: inactive ? "#64748b" : "#92400e", fontWeight: 600 },
      labelBgStyle: { fill: "#fffbeb", fillOpacity: 0.95 },
      style: {
        stroke,
        strokeWidth: inactive ? 1.4 : 2.4,
        strokeDasharray: "6 4",
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
    });
  }

  return { nodes: flowNodes, edges: flowEdges };
}
