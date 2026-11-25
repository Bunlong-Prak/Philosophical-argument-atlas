import type {
  ArgumentHypergraph,
  HermeneuticLensDetail,
  HypergraphAlignmentReport,
  NodeMatch,
  PassageDetail,
  PassageSummary,
  PrecisionRecallF1,
} from "./types";

export interface StaticCorpusBundle {
  version: number;
  passages: PassageSummary[];
  passage_details: Record<string, PassageDetail>;
  lenses: HermeneuticLensDetail[];
  proposition_embeddings: Record<string, number[]>;
}

let bundlePromise: Promise<StaticCorpusBundle> | null = null;

export function loadStaticCorpusBundle(): Promise<StaticCorpusBundle> {
  if (!bundlePromise) {
    bundlePromise = fetch("/corpus-bundle.json")
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`Failed to load /corpus-bundle.json: HTTP ${resp.status}`);
        }
        return resp.json() as Promise<StaticCorpusBundle>;
      })
      .catch((err) => {
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

function computePrf(matched: number, totalA: number, totalB: number): PrecisionRecallF1 {
  if (totalA === 0 && totalB === 0) {
    return { precision: 1, recall: 1, f1: 1, matched: 0, total_a: 0, total_b: 0 };
  }
  const precision = totalA > 0 ? matched / totalA : 0;
  const recall = totalB > 0 ? matched / totalB : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    matched,
    total_a: totalA,
    total_b: totalB,
  };
}

function dotSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < n; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function trigramCosineFallback(a: string, b: string): number {
  const trigrams = (s: string) => {
    const clean = `  ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim()}  `;
    const counts = new Map<string, number>();
    for (let i = 0; i <= clean.length - 3; i++) {
      const tri = clean.slice(i, i + 3);
      counts.set(tri, (counts.get(tri) ?? 0) + 1);
    }
    return counts;
  };
  const mapA = trigrams(a);
  const mapB = trigrams(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, va] of mapA) {
    normA += va * va;
    const vb = mapB.get(k);
    if (vb) dot += va * vb;
  }
  for (const vb of mapB.values()) {
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Exact maximum-weight bipartite matching (Hungarian / Kuhn-Munkres O(N^3))
 * mirroring `scipy.optimize.linear_sum_assignment(-score_matrix)` in `graph_aligner.py`.
 */
function maxWeightBipartiteAssignment(weights: number[][]): Array<[number, number]> {
  const rows = weights.length;
  const cols = rows > 0 ? weights[0].length : 0;
  if (rows === 0 || cols === 0) return [];
  const dim = Math.max(rows, cols);

  const u = new Float64Array(dim + 1);
  const v = new Float64Array(dim + 1);
  const p = new Int32Array(dim + 1);
  const way = new Int32Array(dim + 1);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(dim + 1).fill(Infinity);
    const used = new Uint8Array(dim + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= dim; j++) {
        if (used[j]) continue;
        const w = i0 - 1 < rows && j - 1 < cols ? weights[i0 - 1][j - 1] : 0;
        const cost = -w;
        const cur = cost - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const pairs: Array<[number, number]> = [];
  for (let j = 1; j <= cols; j++) {
    const r = p[j] - 1;
    const c = j - 1;
    if (r >= 0 && r < rows) {
      pairs.push([r, c]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs;
}

export async function alignGraphsStaticFallback(
  graphA: ArgumentHypergraph,
  graphB: ArgumentHypergraph,
  threshold: number,
): Promise<HypergraphAlignmentReport> {
  const bundle = await loadStaticCorpusBundle().catch(() => null);
  const embMap = bundle?.proposition_embeddings ?? {};

  const nodesA = graphA.nodes;
  const nodesB = graphB.nodes;
  const matchedNodes: NodeMatch[] = [];
  const aToB = new Map<string, string>();

  if (nodesA.length > 0 && nodesB.length > 0) {
    const simMatrix: number[][] = nodesA.map((na) =>
      nodesB.map((nb) => {
        if (na.proposition === nb.proposition) return 1.0;
        const va = embMap[na.proposition];
        const vb = embMap[nb.proposition];
        if (va && vb) return dotSimilarity(va, vb);
        return trigramCosineFallback(na.proposition, nb.proposition);
      }),
    );

    const scoreMatrix: number[][] = nodesA.map((na, r) => {
      const aImp = na.node_type === "enthymeme";
      return nodesB.map((nb, c) => {
        const sim = simMatrix[r][c];
        if (sim < threshold) return 0;
        const bImp = nb.node_type === "enthymeme";
        const roleBonus = aImp === bImp ? 0.05 : 0;
        const typeBonus = na.node_type === nb.node_type ? 0.02 : 0;
        return sim + roleBonus + typeBonus;
      });
    });

    const assignment = maxWeightBipartiteAssignment(scoreMatrix);
    for (const [r, c] of assignment) {
      const sim = simMatrix[r][c];
      if (sim >= threshold) {
        const na = nodesA[r];
        const nb = nodesB[c];
        aToB.set(na.id, nb.id);
        matchedNodes.push({
          a_id: na.id,
          b_id: nb.id,
          similarity: Number(sim.toFixed(4)),
          a_type: na.node_type,
          b_type: nb.node_type,
          type_match: na.node_type === nb.node_type,
        });
      }
    }
  }

  const unmatchedA = nodesA.filter((n) => !aToB.has(n.id)).map((n) => n.id);
  const matchedBIds = new Set(aToB.values());
  const unmatchedB = nodesB.filter((n) => !matchedBIds.has(n.id)).map((n) => n.id);

  const nodePrf = computePrf(matchedNodes.length, nodesA.length, nodesB.length);
  const typeAcc =
    matchedNodes.length > 0
      ? matchedNodes.filter((m) => m.type_match).length / matchedNodes.length
      : nodesA.length === 0 && nodesB.length === 0
        ? 1
        : 0;

  const explicitA = nodesA.filter((n) => n.node_type !== "enthymeme").length;
  const explicitB = nodesB.filter((n) => n.node_type !== "enthymeme").length;
  const explicitMatched = matchedNodes.filter(
    (m) => m.a_type !== "enthymeme" && m.b_type !== "enthymeme",
  ).length;
  const explicitPrf = computePrf(explicitMatched, explicitA, explicitB);

  const enthA = nodesA.filter((n) => n.node_type === "enthymeme").length;
  const enthB = nodesB.filter((n) => n.node_type === "enthymeme").length;
  const enthMatched = matchedNodes.filter(
    (m) => m.a_type === "enthymeme" && m.b_type === "enthymeme",
  ).length;
  const enthPrf = computePrf(enthMatched, enthA, enthB);

  const makeHyperSig = (premises: string[], conclusion: string) =>
    `${[...new Set(premises)].toSorted().join("&")}=>${conclusion}`;

  const sigByEdgeA = new Map<string, string>();
  const mappedHyperA = new Set<string>();
  for (const e of graphA.support_hyperedges) {
    if (aToB.has(e.conclusion) && e.premises.every((p) => aToB.has(p))) {
      const sig = makeHyperSig(
        e.premises.map((p) => aToB.get(p)!),
        aToB.get(e.conclusion)!,
      );
      sigByEdgeA.set(e.id, sig);
      mappedHyperA.add(sig);
    }
  }
  const sigByEdgeB = new Map<string, string>();
  const hyperBSet = new Set<string>();
  for (const e of graphB.support_hyperedges) {
    const sig = makeHyperSig(e.premises, e.conclusion);
    sigByEdgeB.set(e.id, sig);
    hyperBSet.add(sig);
  }
  const hyperMatched = [...mappedHyperA].filter((s) => hyperBSet.has(s)).length;
  const supportHyperedgeExactPrf = computePrf(
    hyperMatched,
    graphA.support_hyperedges.length,
    graphB.support_hyperedges.length,
  );

  const linksAMapped = new Set<string>();
  let totalLinksA = 0;
  for (const e of graphA.support_hyperedges) {
    for (const p of e.premises) {
      totalLinksA += 1;
      if (aToB.has(p) && aToB.has(e.conclusion)) {
        linksAMapped.add(`${aToB.get(p)}=>${aToB.get(e.conclusion)}`);
      }
    }
  }
  const linksB = new Set<string>();
  for (const e of graphB.support_hyperedges) {
    for (const p of e.premises) {
      linksB.add(`${p}=>${e.conclusion}`);
    }
  }
  const supportLinkPrf = computePrf(
    [...linksAMapped].filter((s) => linksB.has(s)).length,
    totalLinksA,
    linksB.size,
  );

  const rebsAMapped = new Set<string>();
  for (const r of graphA.rebutting_attacks) {
    if (aToB.has(r.attacker) && aToB.has(r.target)) {
      rebsAMapped.add(`${aToB.get(r.attacker)}->${aToB.get(r.target)}`);
    }
  }
  const rebsB = new Set(graphB.rebutting_attacks.map((r) => `${r.attacker}->${r.target}`));
  const rebuttalPrf = computePrf(
    [...rebsAMapped].filter((s) => rebsB.has(s)).length,
    graphA.rebutting_attacks.length,
    graphB.rebutting_attacks.length,
  );

  const undsAMapped = new Set<string>();
  for (const u of graphA.undercutting_attacks) {
    if (aToB.has(u.attacker) && sigByEdgeA.has(u.target_hyperedge)) {
      undsAMapped.add(`${aToB.get(u.attacker)}_>${sigByEdgeA.get(u.target_hyperedge)}`);
    }
  }
  const undsB = new Set<string>();
  for (const u of graphB.undercutting_attacks) {
    const sig = sigByEdgeB.get(u.target_hyperedge);
    if (sig) undsB.add(`${u.attacker}_>${sig}`);
  }
  const undercutterPrf = computePrf(
    [...undsAMapped].filter((s) => undsB.has(s)).length,
    graphA.undercutting_attacks.length,
    graphB.undercutting_attacks.length,
  );

  const activeRelF1s: number[] = [];
  for (const rel of [supportHyperedgeExactPrf, rebuttalPrf, undercutterPrf]) {
    if (rel.total_a > 0 || rel.total_b > 0) activeRelF1s.push(rel.f1);
  }
  const macroRelF1 =
    activeRelF1s.length > 0
      ? activeRelF1s.reduce((acc, v) => acc + v, 0) / activeRelF1s.length
      : 1;
  const consensus = 0.5 * (nodePrf.f1 + macroRelF1);

  return {
    similarity_threshold: threshold,
    matched_nodes: matchedNodes,
    unmatched_a_nodes: unmatchedA,
    unmatched_b_nodes: unmatchedB,
    node_prf: nodePrf,
    node_type_accuracy: Number(typeAcc.toFixed(4)),
    explicit_node_prf: explicitPrf,
    enthymeme_prf: enthPrf,
    support_hyperedge_exact_prf: supportHyperedgeExactPrf,
    support_link_prf: supportLinkPrf,
    rebuttal_prf: rebuttalPrf,
    undercutter_prf: undercutterPrf,
    macro_relation_f1: Number(macroRelF1.toFixed(4)),
    consensus_score: Number(consensus.toFixed(4)),
  };
}
