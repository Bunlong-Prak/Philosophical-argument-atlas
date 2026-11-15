use crate::gradual::{solve_df_quad, GradualSolverConfig};
use crate::model::{ArgumentHypergraph, HypergraphError, NodeType};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Configuration for Minimal Premise Knockout ("Achilles' Heel") search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnockoutConfig {
    /// Target proposition node ID (typically the overarching Thesis) to collapse.
    pub target_node_id: String,
    /// Target is considered collapsed when $\sigma^*(\text{target}) \le \text{collapse\_threshold}$.
    pub collapse_threshold: f64,
    /// Maximum subset cardinality $k$ to search.
    pub max_subset_size: usize,
    /// Node types eligible for knockout perturbation.
    pub eligible_node_types: Vec<NodeType>,
    pub solver_config: GradualSolverConfig,
}

impl KnockoutConfig {
    pub fn for_target(target_node_id: impl Into<String>) -> Self {
        Self {
            target_node_id: target_node_id.into(),
            collapse_threshold: 0.50,
            max_subset_size: 4,
            eligible_node_types: vec![NodeType::ExplicitPremise, NodeType::Enthymeme],
            solver_config: GradualSolverConfig::default(),
        }
    }
}

/// An inclusion-minimal set of premise/enthymeme nodes whose rejection collapses the target thesis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinimalKnockout {
    pub removed_node_ids: Vec<String>,
    pub cardinality: usize,
    /// Sum of original `base_credence` values across removed nodes ($\sum_{k \in K} \sigma_0(k)$).
    /// Lower epistemic cost identifies assumptions that are easier/more plausible to challenge.
    pub credence_cost: f64,
    pub baseline_acceptability: f64,
    pub post_knockout_acceptability: f64,
    pub acceptability_drop: f64,
}

struct CandidateNode {
    node_idx: usize,
    id: String,
    original_credence: f64,
}

/// Finds all inclusion-minimal subsets $K$ of eligible premises/enthymemes up to
/// `config.max_subset_size` whose removal (`base_credence = 0.0`) drops the target's
/// `DF-QuAD` acceptability score to $\le \text{collapse\_threshold}$.
pub fn find_minimal_knockouts(
    graph: &ArgumentHypergraph,
    config: &KnockoutConfig,
) -> Result<Vec<MinimalKnockout>, HypergraphError> {
    graph.validate(false)?;

    if !graph.nodes.iter().any(|n| n.id == config.target_node_id) {
        return Err(HypergraphError::UnknownNodeReference {
            missing_id: config.target_node_id.clone(),
            context: "knockout target_node_id".to_string(),
        });
    }

    let baseline_eval = solve_df_quad(graph, &config.solver_config)?;
    let baseline_acceptability = baseline_eval.node_acceptability[&config.target_node_id];

    if baseline_acceptability <= config.collapse_threshold {
        return Ok(Vec::new());
    }

    let candidates: Vec<CandidateNode> = graph
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| {
            n.id != config.target_node_id
                && n.base_credence > 0.0
                && config.eligible_node_types.contains(&n.node_type)
        })
        .map(|(node_idx, n)| CandidateNode {
            node_idx,
            id: n.id.clone(),
            original_credence: n.base_credence,
        })
        .collect();

    let max_k = config.max_subset_size.min(candidates.len());
    if max_k == 0 {
        return Ok(Vec::new());
    }

    let mut working_graph = graph.clone();
    let mut minimal_combos: Vec<Vec<usize>> = Vec::new();
    let mut results: Vec<MinimalKnockout> = Vec::new();
    let mut in_combo = vec![false; candidates.len()];

    for k in 1..=max_k {
        let mut combo: Vec<usize> = (0..k).collect();
        loop {
            for &idx in &combo {
                in_combo[idx] = true;
            }

            // Minimal hitting-set pruning: skip any superset of a previously found knockout.
            let is_superset = minimal_combos
                .iter()
                .any(|ko| ko.iter().all(|&i| in_combo[i]));

            if !is_superset {
                let mut credence_cost = 0.0;
                for &idx in &combo {
                    let cand = &candidates[idx];
                    working_graph.nodes[cand.node_idx].base_credence = 0.0;
                    credence_cost += cand.original_credence;
                }

                let eval = solve_df_quad(&working_graph, &config.solver_config)?;
                let post_acceptability = eval.node_acceptability[&config.target_node_id];

                // Restore original base credences immediately.
                for &idx in &combo {
                    let cand = &candidates[idx];
                    working_graph.nodes[cand.node_idx].base_credence = cand.original_credence;
                }

                if post_acceptability <= config.collapse_threshold {
                    let removed_node_ids: Vec<String> =
                        combo.iter().map(|&idx| candidates[idx].id.clone()).collect();
                    results.push(MinimalKnockout {
                        removed_node_ids,
                        cardinality: k,
                        credence_cost,
                        baseline_acceptability,
                        post_knockout_acceptability: post_acceptability,
                        acceptability_drop: baseline_acceptability - post_acceptability,
                    });
                    minimal_combos.push(combo.clone());
                }
            }

            for &idx in &combo {
                in_combo[idx] = false;
            }

            if !advance_combination(&mut combo, candidates.len()) {
                break;
            }
        }
    }

    results.sort_by(|a, b| {
        a.credence_cost
            .partial_cmp(&b.credence_cost)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.cardinality.cmp(&b.cardinality))
            .then_with(|| {
                b.acceptability_drop
                    .partial_cmp(&a.acceptability_drop)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| a.removed_node_ids.cmp(&b.removed_node_ids))
    });

    Ok(results)
}

fn advance_combination(combo: &mut [usize], n: usize) -> bool {
    let k = combo.len();
    for i in (0..k).rev() {
        if combo[i] < n - k + i {
            combo[i] += 1;
            for j in (i + 1)..k {
                combo[j] = combo[j - 1] + 1;
            }
            return true;
        }
    }
    false
}
