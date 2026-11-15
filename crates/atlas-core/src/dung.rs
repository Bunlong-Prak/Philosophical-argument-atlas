use crate::model::{ArgumentHypergraph, HypergraphError, NodeType};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

/// 3-valued Dung / Caminada argumentation acceptability label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Label {
    In,
    Out,
    Undecided,
}

/// Classical Abstract Argumentation Framework $\text{AF} = (A, R)$ (Dung, 1995).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DungFramework {
    pub arguments: Vec<String>,
    /// Directed attack pairs `(attacker, target)` representing $a \to b \in R$.
    pub attacks: Vec<(String, String)>,
}

struct IndexedDung {
    n: usize,
    names: Vec<String>,
    attackers: Vec<Vec<usize>>,
    targets: Vec<Vec<usize>>,
    self_attacking: Vec<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchState {
    Blank,
    In,
    Out,
    MustOut,
    Blocked,
}

impl DungFramework {
    fn index(&self) -> IndexedDung {
        let mut names = Vec::with_capacity(self.arguments.len());
        let mut idx_map = HashMap::with_capacity(self.arguments.len());
        for arg in &self.arguments {
            if !idx_map.contains_key(arg.as_str()) {
                let idx = names.len();
                idx_map.insert(arg.as_str(), idx);
                names.push(arg.clone());
            }
        }

        let n = names.len();
        let mut attacker_sets: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
        let mut target_sets: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
        let mut self_attacking = vec![false; n];

        for (att, tgt) in &self.attacks {
            if let (Some(&a), Some(&t)) = (idx_map.get(att.as_str()), idx_map.get(tgt.as_str())) {
                attacker_sets[t].insert(a);
                target_sets[a].insert(t);
                if a == t {
                    self_attacking[a] = true;
                }
            }
        }

        IndexedDung {
            n,
            names,
            attackers: attacker_sets
                .into_iter()
                .map(|s| s.into_iter().collect())
                .collect(),
            targets: target_sets
                .into_iter()
                .map(|s| s.into_iter().collect())
                .collect(),
            self_attacking,
        }
    }

    /// Computes the unique Grounded Extension as the least fixed point of Dung's
    /// characteristic function $\mathcal{F}(S) = \{a \mid \forall b \in \text{att}^-(a), \exists c \in S: (c, b) \in R\}$.
    pub fn compute_grounded_extension(&self) -> BTreeSet<String> {
        let d = self.index();
        let in_set = compute_grounded_indices(&d);
        in_set.into_iter().map(|i| d.names[i].clone()).collect()
    }

    /// Computes all Preferred Extensions ($\subseteq$-maximal admissible sets) via
    /// constraint-propagated labeling search seeded from the grounded extension.
    pub fn compute_preferred_extensions(&self) -> Vec<BTreeSet<String>> {
        let d = self.index();
        let maximal_sets = compute_preferred_index_sets(&d);
        let mut result: Vec<BTreeSet<String>> = maximal_sets
            .into_iter()
            .map(|set| set.into_iter().map(|i| d.names[i].clone()).collect())
            .collect();
        result.sort();
        result.dedup();
        if result.is_empty() {
            result.push(BTreeSet::new());
        }
        result
    }

    /// Computes all Stable Extensions (conflict-free sets attacking every external argument).
    /// Because every stable extension is a preferred extension (Dung, 1995), we filter the
    /// preferred extensions against the range criterion.
    pub fn compute_stable_extensions(&self) -> Vec<BTreeSet<String>> {
        let d = self.index();
        let preferred = compute_preferred_index_sets(&d);
        let mut stable: Vec<BTreeSet<String>> = Vec::new();

        for ext in preferred {
            let mut attacked_or_in = vec![false; d.n];
            for &a in &ext {
                attacked_or_in[a] = true;
                for &t in &d.targets[a] {
                    attacked_or_in[t] = true;
                }
            }
            if attacked_or_in.iter().all(|&covered| covered) {
                stable.push(ext.into_iter().map(|i| d.names[i].clone()).collect());
            }
        }

        stable.sort();
        stable.dedup();
        stable
    }
}

fn compute_grounded_indices(d: &IndexedDung) -> BTreeSet<usize> {
    let mut current = vec![false; d.n];
    let mut defeated = vec![false; d.n];

    loop {
        let mut changed = false;
        for a in 0..d.n {
            if current[a] {
                continue;
            }
            if d.attackers[a].iter().all(|&att| defeated[att]) {
                current[a] = true;
                changed = true;
                for &tgt in &d.targets[a] {
                    defeated[tgt] = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    (0..d.n).filter(|&i| current[i]).collect()
}

fn assign_in(d: &IndexedDung, states: &mut [SearchState], x: usize) -> bool {
    if d.self_attacking[x] || states[x] != SearchState::Blank {
        return false;
    }
    for &t in &d.targets[x] {
        if states[t] == SearchState::In {
            return false;
        }
    }
    for &att in &d.attackers[x] {
        if states[att] == SearchState::In {
            return false;
        }
    }

    states[x] = SearchState::In;

    for &t in &d.targets[x] {
        if t == x {
            return false;
        }
        states[t] = SearchState::Out;
    }

    for &att in &d.attackers[x] {
        match states[att] {
            SearchState::In => return false,
            SearchState::Out | SearchState::MustOut => {}
            SearchState::Blank | SearchState::Blocked => {
                states[att] = SearchState::MustOut;
            }
        }
    }

    true
}

fn propagate_and_validate(d: &IndexedDung, states: &mut [SearchState]) -> bool {
    loop {
        let mut changed = false;

        // 1. Prune if any MustOut node has no remaining In or Blank attacker.
        for a in 0..d.n {
            if states[a] == SearchState::MustOut {
                let can_be_attacked = d.attackers[a]
                    .iter()
                    .any(|&att| matches!(states[att], SearchState::In | SearchState::Blank));
                if !can_be_attacked {
                    return false;
                }
            }
        }

        // 2. Any Blank node with a non-Out attacker that can never become Out can never be defended.
        for a in 0..d.n {
            if states[a] == SearchState::Blank {
                let un_defendable = d.attackers[a].iter().any(|&att| {
                    states[att] != SearchState::Out
                        && !d.attackers[att]
                            .iter()
                            .any(|&def| matches!(states[def], SearchState::In | SearchState::Blank))
                });
                if un_defendable {
                    states[a] = SearchState::Blocked;
                    changed = true;
                }
            }
        }

        // 3. Any Blank node whose attackers are all Out must belong to every maximal admissible
        //    extension extending this partial assignment (grounded-style forced inclusion).
        for a in 0..d.n {
            if states[a] == SearchState::Blank
                && d.attackers[a].iter().all(|&att| states[att] == SearchState::Out)
            {
                if !assign_in(d, states, a) {
                    return false;
                }
                changed = true;
            }
        }

        if !changed {
            return true;
        }
    }
}

fn search_admissible(d: &IndexedDung, states: Vec<SearchState>, results: &mut Vec<BTreeSet<usize>>) {
    let mut work = states;
    if !propagate_and_validate(d, &mut work) {
        return;
    }

    // Choose next Blank node (preferring highest degree in unresolved subgraph to fail fast).
    let next_blank = (0..d.n)
        .filter(|&i| work[i] == SearchState::Blank)
        .max_by_key(|&i| d.attackers[i].len() + d.targets[i].len());

    match next_blank {
        None => {
            if work.iter().any(|&s| s == SearchState::MustOut) {
                return;
            }
            let ext: BTreeSet<usize> = (0..d.n).filter(|&i| work[i] == SearchState::In).collect();
            results.push(ext);
        }
        Some(x) => {
            let mut branch_in = work.clone();
            if assign_in(d, &mut branch_in, x) {
                search_admissible(d, branch_in, results);
            }

            let mut branch_blocked = work;
            branch_blocked[x] = SearchState::Blocked;
            search_admissible(d, branch_blocked, results);
        }
    }
}

fn compute_preferred_index_sets(d: &IndexedDung) -> Vec<BTreeSet<usize>> {
    let mut init_states = vec![SearchState::Blank; d.n];
    for a in 0..d.n {
        if d.self_attacking[a] {
            init_states[a] = SearchState::Blocked;
        }
    }

    let mut admissible_sets = Vec::new();
    search_admissible(d, init_states, &mut admissible_sets);

    // Filter to $\subseteq$-maximal admissible sets.
    admissible_sets.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    admissible_sets.dedup();

    let mut preferred: Vec<BTreeSet<usize>> = Vec::new();
    for candidate in admissible_sets {
        let is_strict_subset = preferred.iter().any(|sup| candidate.is_subset(sup));
        if !is_strict_subset {
            preferred.push(candidate);
        }
    }

    if preferred.is_empty() {
        preferred.push(BTreeSet::new());
    }
    preferred
}

/// Output of solving Dung acceptability semantics over a compiled `ArgumentHypergraph`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HypergraphDungResult {
    /// Grounded extension projected onto original proposition node IDs.
    pub grounded: BTreeSet<String>,
    /// All preferred extensions projected onto original proposition node IDs.
    pub preferred: Vec<BTreeSet<String>>,
    /// All stable extensions projected onto original proposition node IDs.
    pub stable: Vec<BTreeSet<String>>,
    /// Grounded acceptability label (`In`, `Out`, or `Undecided`) for every proposition node ID.
    pub grounded_labels: BTreeMap<String, Label>,
    pub compiled_argument_count: usize,
    pub compiled_attack_count: usize,
}

fn node_arg_id(id: &str) -> String {
    format!("node:{id}")
}

fn edge_arg_id(id: &str) -> String {
    format!("edge:{id}")
}

fn guard_arg_id(id: &str) -> String {
    format!("unwarranted:{id}")
}

/// Reduces a Bipolar Argumentation Hypergraph into a standard Dung Abstract Argumentation
/// Framework via the **Inference-Gate Auxiliary Node Reduction** (ASPIC+ / Pollock 1987).
pub fn compile_hypergraph_to_dung(
    graph: &ArgumentHypergraph,
) -> Result<DungFramework, HypergraphError> {
    graph.validate(false)?;

    let mut incoming_support: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &graph.support_hyperedges {
        if edge.weight > 0.0 {
            incoming_support
                .entry(edge.conclusion.as_str())
                .or_default()
                .push(edge.id.as_str());
        }
    }

    let mut active_node_ids: HashSet<&str> = HashSet::new();
    let mut arguments: Vec<String> = Vec::new();
    let mut attack_set: BTreeSet<(String, String)> = BTreeSet::new();

    // 1. Add proposition nodes that either have positive intrinsic credence or incoming support.
    for node in &graph.nodes {
        let has_support = incoming_support.contains_key(node.id.as_str());
        if node.base_credence > 0.0 || has_support {
            active_node_ids.insert(node.id.as_str());
            arguments.push(node_arg_id(&node.id));

            // Add Support-Deficiency Guard if derived claim requires support.
            if has_support && (node.base_credence < 0.5 || node.node_type == NodeType::Thesis) {
                let guard = guard_arg_id(&node.id);
                arguments.push(guard.clone());
                attack_set.insert((guard, node_arg_id(&node.id)));
            }
        }
    }

    // 2. Add active support hyperedges where every linked premise is present.
    let mut active_edges = Vec::new();
    for edge in &graph.support_hyperedges {
        if edge.weight <= 0.0 {
            continue;
        }
        let all_premises_active = edge
            .premises
            .iter()
            .all(|p| active_node_ids.contains(p.as_str()));
        if !all_premises_active || !active_node_ids.contains(edge.conclusion.as_str()) {
            continue;
        }

        let e_arg = edge_arg_id(&edge.id);
        arguments.push(e_arg.clone());
        active_edges.push(edge);

        let conclusion_guard = guard_arg_id(&edge.conclusion);
        if arguments.iter().any(|a| a == &conclusion_guard) {
            attack_set.insert((e_arg, conclusion_guard));
        }
    }

    // 3. Add Rebutting and Undercutting attacks.
    for att in &graph.rebutting_attacks {
        if att.weight > 0.0
            && active_node_ids.contains(att.attacker.as_str())
            && active_node_ids.contains(att.target.as_str())
        {
            attack_set.insert((node_arg_id(&att.attacker), node_arg_id(&att.target)));
        }
    }

    let active_edge_ids: HashSet<&str> = active_edges.iter().map(|e| e.id.as_str()).collect();
    for und in &graph.undercutting_attacks {
        if und.weight > 0.0
            && active_node_ids.contains(und.attacker.as_str())
            && active_edge_ids.contains(und.target_hyperedge.as_str())
        {
            attack_set.insert((
                node_arg_id(&und.attacker),
                edge_arg_id(&und.target_hyperedge),
            ));
        }
    }

    // 4. Pass 2 — Premise-to-Hyperedge defeat propagation:
    //    For each active hyperedge e = (S, c) and each premise p in S, every attacker x of
    //    `node:{p}` (including `unwarranted:{p}`) must also attack `edge:{e}` so conjunctive
    //    hyperedges collapse transitively whenever any linked premise is defeated.
    let mut node_attackers: HashMap<String, Vec<String>> = HashMap::new();
    for (att, tgt) in &attack_set {
        if tgt.starts_with("node:") {
            node_attackers
                .entry(tgt.clone())
                .or_default()
                .push(att.clone());
        }
    }

    for edge in active_edges {
        let e_arg = edge_arg_id(&edge.id);
        for p in &edge.premises {
            let p_arg = node_arg_id(p);
            if let Some(attackers) = node_attackers.get(&p_arg) {
                for att in attackers {
                    attack_set.insert((att.clone(), e_arg.clone()));
                }
            }
        }
    }

    Ok(DungFramework {
        arguments,
        attacks: attack_set.into_iter().collect(),
    })
}

fn project_extension(ext: &BTreeSet<String>) -> BTreeSet<String> {
    ext.iter()
        .filter_map(|arg| arg.strip_prefix("node:").map(ToString::to_string))
        .collect()
}

/// Compiles `graph` into a `DungFramework`, computes Grounded, Preferred, and Stable
/// extensions, and projects them back onto the proposition node IDs $\mathcal{A}$.
pub fn solve_hypergraph_dung(
    graph: &ArgumentHypergraph,
) -> Result<HypergraphDungResult, HypergraphError> {
    let df = compile_hypergraph_to_dung(graph)?;

    let raw_grounded = df.compute_grounded_extension();
    let raw_preferred = df.compute_preferred_extensions();
    let raw_stable = df.compute_stable_extensions();

    let grounded = project_extension(&raw_grounded);

    let mut preferred: Vec<BTreeSet<String>> =
        raw_preferred.iter().map(project_extension).collect();
    preferred.sort();
    preferred.dedup();

    let mut stable: Vec<BTreeSet<String>> = raw_stable.iter().map(project_extension).collect();
    stable.sort();
    stable.dedup();

    // Determine grounded label for every original proposition node.
    let active_args: HashSet<&str> = df.arguments.iter().map(String::as_str).collect();
    let mut attacked_by_grounded: HashSet<&str> = HashSet::new();
    for (att, tgt) in &df.attacks {
        if raw_grounded.contains(att) {
            attacked_by_grounded.insert(tgt.as_str());
        }
    }

    let mut grounded_labels = BTreeMap::new();
    for node in &graph.nodes {
        let arg = node_arg_id(&node.id);
        let label = if raw_grounded.contains(&arg) {
            Label::In
        } else if !active_args.contains(arg.as_str())
            || attacked_by_grounded.contains(arg.as_str())
        {
            Label::Out
        } else {
            Label::Undecided
        };
        grounded_labels.insert(node.id.clone(), label);
    }

    Ok(HypergraphDungResult {
        grounded,
        preferred,
        stable,
        grounded_labels,
        compiled_argument_count: df.arguments.len(),
        compiled_attack_count: df.attacks.len(),
    })
}
