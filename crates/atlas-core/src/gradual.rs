use crate::model::{ArgumentHypergraph, HypergraphError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// T-norm operator used to combine linked premises $S = \{p_1, \dots, p_k\}$ inside a conjunctive hyperedge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConjunctiveNorm {
    /// Gödel T-norm: $\min_{p \in S} \sigma(p)$ ("weakest link" principle of deductive logic).
    GodelMinimum,
    /// Product T-norm: $\prod_{p \in S} \sigma(p)$ (independent probabilistic conjunction).
    Product,
}

/// Configuration for the Hypergraph `DF-QuAD` continuous gradual semantics solver.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradualSolverConfig {
    pub t_norm: ConjunctiveNorm,
    /// Maximum fixed-point iterations for cyclic dialectical graphs.
    pub max_iterations: usize,
    /// Convergence tolerance $\epsilon$ on $L_\infty$ norm $\|\sigma^{(t+1)} - \sigma^{(t)}\|_\infty$.
    pub tolerance: f64,
    /// Damping factor $\alpha \in (0.0, 1.0]$ for Successive Over-Relaxation:
    /// $\sigma^{(t+1)} = (1 - \alpha)\sigma^{(t)} + \alpha F(\sigma^{(t)})$.
    /// $\alpha = 1.0$ is un-damped substitution; $\alpha = 0.5$ prevents oscillation on mutual attack cycles.
    pub damping: f64,
}

impl Default for GradualSolverConfig {
    fn default() -> Self {
        Self {
            t_norm: ConjunctiveNorm::GodelMinimum,
            max_iterations: 200,
            tolerance: 1e-7,
            damping: 0.6,
        }
    }
}

/// Result of solving continuous gradual acceptability over an `ArgumentHypergraph`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradualEvaluation {
    /// Final dialectical acceptability score $\sigma^*(a) \in [0.0, 1.0]$ for each proposition node ID.
    pub node_acceptability: HashMap<String, f64>,
    /// Final effective transmission strength $\tau(e) \in [0.0, 1.0]$ for each support hyperedge ID
    /// after accounting for premise conjunction and undercutting attacks.
    pub hyperedge_transmission: HashMap<String, f64>,
    /// Number of iterations required to reach fixed-point convergence.
    pub iterations: usize,
    /// Maximum residual change $\max_a |\sigma^{(t)}(a) - \sigma^{(t-1)}(a)|$ at termination.
    pub final_residual: f64,
    /// Whether the solver converged below `config.tolerance`.
    pub converged: bool,
}

/// Computes the `DF-QuAD` (Discontinuity-Free Quantitative Argumentation Debate) aggregation
/// function (Rago et al., KR 2016) extended to Bipolar Argumentation Hypergraphs.
///
/// Given intrinsic base score $v_0 \in [0, 1]$, aggregate attack $v_{\text{att}} \in [0, 1]$,
/// and aggregate support $v_{\text{sup}} \in [0, 1]$:
///
/// $$v = v_{\text{sup}} - v_{\text{att}}$$
///
/// $$\mathcal{C}(v_0, v_{\text{att}}, v_{\text{sup}}) = \begin{cases}
/// v_0 - v_0 \cdot |v| & \text{if } v \le 0 \\
/// v_0 + (1 - v_0) \cdot v & \text{if } v > 0
/// \end{cases}$$
#[inline]
pub fn df_quad_combine(v0: f64, v_att: f64, v_sup: f64) -> f64 {
    let v = v_sup - v_att;
    let score = if v <= 0.0 {
        v0 - v0 * v.abs()
    } else {
        v0 + (1.0 - v0) * v
    };
    score.clamp(0.0, 1.0)
}

/// Solves continuous acceptability propagation over a Bipolar Argumentation Hypergraph.
pub fn solve_df_quad(
    graph: &ArgumentHypergraph,
    config: &GradualSolverConfig,
) -> Result<GradualEvaluation, HypergraphError> {
    graph.validate(false)?;

    let n = graph.nodes.len();
    let node_idx = graph.node_index_map();

    // Pre-index hyperedges, rebuttals, and undercutters by integer indices for O(E) inner loop speed.
    struct IndexedHyperedge {
        premises: Vec<usize>,
        conclusion: usize,
        weight: f64,
        undercutters: Vec<(usize, f64)>, // (attacker_node_idx, attack_weight)
    }

    let mut undercutters_by_edge: HashMap<&str, Vec<(usize, f64)>> = HashMap::new();
    for und in &graph.undercutting_attacks {
        let att_idx = node_idx[und.attacker.as_str()];
        undercutters_by_edge
            .entry(und.target_hyperedge.as_str())
            .or_default()
            .push((att_idx, und.weight));
    }

    let indexed_edges: Vec<IndexedHyperedge> = graph
        .support_hyperedges
        .iter()
        .map(|e| IndexedHyperedge {
            premises: e
                .premises
                .iter()
                .map(|p| node_idx[p.as_str()])
                .collect(),
            conclusion: node_idx[e.conclusion.as_str()],
            weight: e.weight,
            undercutters: undercutters_by_edge
                .remove(e.id.as_str())
                .unwrap_or_default(),
        })
        .collect();

    let mut incoming_support_edges: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (edge_i, edge) in indexed_edges.iter().enumerate() {
        incoming_support_edges[edge.conclusion].push(edge_i);
    }

    let mut incoming_rebuttals: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for att in &graph.rebutting_attacks {
        let attacker_i = node_idx[att.attacker.as_str()];
        let target_i = node_idx[att.target.as_str()];
        incoming_rebuttals[target_i].push((attacker_i, att.weight));
    }

    // Initialize state $\sigma^{(0)}(a) = \sigma_0(a)$.
    let base_scores: Vec<f64> = graph.nodes.iter().map(|node| node.base_credence).collect();
    let mut current_scores = base_scores.clone();
    let mut next_scores = base_scores.clone();
    let mut edge_transmissions = vec![0.0_f64; indexed_edges.len()];

    let mut iterations = 0;
    let mut final_residual = 0.0_f64;
    let mut converged = false;

    for iter in 1..=config.max_iterations {
        iterations = iter;

        // 1. Compute effective transmission $\tau(e)$ for each support hyperedge:
        //    $\tau(e) = w_e \cdot T_{p \in S}(\sigma(p)) \cdot \prod_{u \in U(e)} (1 - w_u \cdot \sigma(u))$
        for (edge_i, edge) in indexed_edges.iter().enumerate() {
            let conjunctive_strength = match config.t_norm {
                ConjunctiveNorm::GodelMinimum => edge
                    .premises
                    .iter()
                    .map(|&p_idx| current_scores[p_idx])
                    .fold(1.0_f64, f64::min),
                ConjunctiveNorm::Product => edge
                    .premises
                    .iter()
                    .map(|&p_idx| current_scores[p_idx])
                    .product(),
            };

            let undercut_survival: f64 = edge
                .undercutters
                .iter()
                .map(|&(u_idx, u_weight)| (1.0 - u_weight * current_scores[u_idx]).clamp(0.0, 1.0))
                .product();

            edge_transmissions[edge_i] =
                (edge.weight * conjunctive_strength * undercut_survival).clamp(0.0, 1.0);
        }

        // 2. Compute updated node acceptability $\sigma(a)$ for each proposition:
        let mut max_diff = 0.0_f64;
        for i in 0..n {
            let has_support = !incoming_support_edges[i].is_empty();
            let has_attack = !incoming_rebuttals[i].is_empty();

            let target_score = if !has_support && !has_attack {
                base_scores[i]
            } else {
                // Aggregate incoming support: $v_{\text{sup}}(a) = 1 - \prod_{e \in \text{Sup}(a)} (1 - \tau(e))$
                let v_sup = 1.0
                    - incoming_support_edges[i]
                        .iter()
                        .map(|&edge_i| 1.0 - edge_transmissions[edge_i])
                        .product::<f64>();

                // Aggregate incoming rebuttals: $v_{\text{att}}(a) = 1 - \prod_{b \in \text{Att}(a)} (1 - w_b \cdot \sigma(b))$
                let v_att = 1.0
                    - incoming_rebuttals[i]
                        .iter()
                        .map(|&(att_i, w)| (1.0 - w * current_scores[att_i]).clamp(0.0, 1.0))
                        .product::<f64>();

                df_quad_combine(base_scores[i], v_att, v_sup)
            };

            // Apply damped relaxation on cyclic graphs; if iteration == 1 and node only depends on
            // already-settled values, damping still converges smoothly.
            let updated = (1.0 - config.damping) * current_scores[i] + config.damping * target_score;
            let diff = (updated - current_scores[i]).abs();
            if diff > max_diff {
                max_diff = diff;
            }
            next_scores[i] = updated;
        }

        current_scores.copy_from_slice(&next_scores);
        final_residual = max_diff;

        if max_diff <= config.tolerance {
            converged = true;
            break;
        }
    }

    let node_acceptability = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id.clone(), current_scores[i]))
        .collect();

    let hyperedge_transmission = graph
        .support_hyperedges
        .iter()
        .enumerate()
        .map(|(i, edge)| (edge.id.clone(), edge_transmissions[i]))
        .collect();

    Ok(GradualEvaluation {
        node_acceptability,
        hyperedge_transmission,
        iterations,
        final_residual,
        converged,
    })
}
