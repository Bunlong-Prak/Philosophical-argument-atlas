use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

/// Formal error types for validating a Bipolar Argumentation Hypergraph.
/// Ensures zero ungrounded spans or dangling graph references enter the solver.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum HypergraphError {
    #[error("Duplicate proposition node ID: '{0}'")]
    DuplicateNodeId(String),

    #[error("Duplicate support hyperedge ID: '{0}'")]
    DuplicateHyperedgeId(String),

    #[error("Proposition node '{0}' has invalid base credence {1}: must be in [0.0, 1.0]")]
    InvalidBaseCredence(String, String),

    #[error("Support hyperedge '{0}' has an empty premise set; at least one premise is required")]
    EmptyHyperedgePremises(String),

    #[error("Support hyperedge '{0}' has invalid warrant weight {1}: must be in [0.0, 1.0]")]
    InvalidHyperedgeWeight(String, String),

    #[error("Reference to unknown proposition node ID '{missing_id}' in {context}")]
    UnknownNodeReference { missing_id: String, context: String },

    #[error("Undercutting attack '{attack_id}' references unknown support hyperedge ID '{missing_hyperedge_id}'")]
    UnknownHyperedgeReference {
        attack_id: String,
        missing_hyperedge_id: String,
    },

    #[error("Explicit node '{node_id}' is missing a source text span")]
    MissingSpanForExplicitNode { node_id: String },

    #[error("Node '{node_id}' span [{start}..{end}] is out of bounds for source text of length {text_len}")]
    SpanOutOfBounds {
        node_id: String,
        start: usize,
        end: usize,
        text_len: usize,
    },

    #[error("Node '{node_id}' span quote mismatch: expected '{expected}', found '{actual}' in source text")]
    SpanQuoteMismatch {
        node_id: String,
        expected: String,
        actual: String,
    },
}

/// Role of a proposition inside a philosophical argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    /// Primary conclusion or overarching philosophical thesis.
    Thesis,
    /// Explicitly stated premise or intermediate claim grounded in the source text.
    ExplicitPremise,
    /// Unspoken background assumption reconstructed abductively to bridge an inference gap.
    Enthymeme,
    /// Dialectical objection or counter-claim raised against another proposition or inference.
    Objection,
    /// Suppositional premise introduced for reductio ad absurdum or thought experiment.
    CounterfactualAssumption,
}

/// Character-level grounding in the primary source text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextSpan {
    /// Byte/character start offset (inclusive) in `source_text`.
    pub start_char: usize,
    /// Byte/character end offset (exclusive) in `source_text`.
    pub end_char: usize,
    /// Exact verbatim substring extracted from the source text.
    pub verbatim_quote: String,
}

/// Classical and informal logic argumentation schemes (Walton, 2008).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArgumentationScheme {
    ModusPonens,
    ModusTollens,
    DisjunctiveSyllogism,
    ReductioAdAbsurdum,
    TranscendentalDeduction,
    Analogy,
    CausalToEffect,
    Consequence,
    SignOrEvidence,
    DefeasibleGeneralization,
    PracticalReasoning,
    Custom(String),
}

/// A proposition node $a \in \mathcal{A}$ in the Bipolar Argumentation Hypergraph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropositionNode {
    pub id: String,
    /// Normalized declarative proposition statement.
    pub proposition: String,
    pub node_type: NodeType,
    /// Required for explicit claims; `None` for reconstructed `Enthymeme` nodes.
    pub span: Option<TextSpan>,
    /// Optional speaker/voice attribution (critical for dialogues like Plato or Dostoevsky).
    pub speaker: Option<String>,
    /// Intrinsic base credence $\sigma_0(a) \in [0.0, 1.0]$ before dialectical propagation.
    pub base_credence: f64,
}

/// A conjunctive support hyperedge $e = (S, c, w_e) \in \mathcal{E}_{\text{sup}}$.
/// Models linked premises $S = \{p_1, \dots, p_k\}$ that *jointly* support conclusion $c$.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportHyperedge {
    pub id: String,
    /// Non-empty set of linked premise node IDs that must hold together.
    pub premises: Vec<String>,
    /// Target conclusion node ID.
    pub conclusion: String,
    /// Inferential warrant strength $w_e \in [0.0, 1.0]$ (e.g., NLI sufficiency score).
    pub weight: f64,
    pub scheme: Option<ArgumentationScheme>,
}

/// Direct rebutting attack $(a \to b) \in \mathcal{E}_{\text{att}}$ between two propositions.
/// Accepting `attacker` directly reduces the acceptability of `target`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebuttingAttack {
    pub id: String,
    pub attacker: String,
    pub target: String,
    pub weight: f64,
}

/// Pollock-style undercutting attack $(u \to e) \in \mathcal{E}_{\text{und}}$.
/// Rather than denying the conclusion directly, `attacker` attacks the *inference hyperedge*
/// $e \in \mathcal{E}_{\text{sup}}$, severing the warrant between premises and conclusion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndercuttingAttack {
    pub id: String,
    pub attacker: String,
    pub target_hyperedge: String,
    pub weight: f64,
}

/// Formal Bipolar Argumentation Hypergraph $\mathcal{H} = (\mathcal{A}, \mathcal{E}_{\text{sup}}, \mathcal{E}_{\text{att}}, \mathcal{E}_{\text{und}}, \sigma_0)$.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ArgumentHypergraph {
    pub passage_id: String,
    pub source_text: Option<String>,
    pub nodes: Vec<PropositionNode>,
    pub support_hyperedges: Vec<SupportHyperedge>,
    pub rebutting_attacks: Vec<RebuttingAttack>,
    pub undercutting_attacks: Vec<UndercuttingAttack>,
}

impl ArgumentHypergraph {
    /// Deterministically validates all structural, numerical, and source-grounding invariants.
    /// If `require_strict_spans` is true and `source_text` is present, every non-Enthymeme node
    /// must carry a `TextSpan` whose character indices slice to `verbatim_quote` in `source_text`.
    pub fn validate(&self, require_strict_spans: bool) -> Result<(), HypergraphError> {
        let mut node_ids = HashSet::with_capacity(self.nodes.len());
        let char_vec: Option<Vec<char>> = self.source_text.as_ref().map(|s| s.chars().collect());

        for node in &self.nodes {
            if !node_ids.insert(node.id.as_str()) {
                return Err(HypergraphError::DuplicateNodeId(node.id.clone()));
            }
            if !(0.0..=1.0).contains(&node.base_credence) || node.base_credence.is_nan() {
                return Err(HypergraphError::InvalidBaseCredence(
                    node.id.clone(),
                    format!("{}", node.base_credence),
                ));
            }

            if require_strict_spans {
                if let Some(ref chars) = char_vec {
                    match (&node.node_type, &node.span) {
                        (NodeType::Enthymeme, None) => {}
                        (_, None) => {
                            return Err(HypergraphError::MissingSpanForExplicitNode {
                                node_id: node.id.clone(),
                            });
                        }
                        (_, Some(span)) => {
                            if span.start_char >= span.end_char || span.end_char > chars.len() {
                                return Err(HypergraphError::SpanOutOfBounds {
                                    node_id: node.id.clone(),
                                    start: span.start_char,
                                    end: span.end_char,
                                    text_len: chars.len(),
                                });
                            }
                            let sliced: String =
                                chars[span.start_char..span.end_char].iter().collect();
                            if sliced != span.verbatim_quote {
                                return Err(HypergraphError::SpanQuoteMismatch {
                                    node_id: node.id.clone(),
                                    expected: span.verbatim_quote.clone(),
                                    actual: sliced,
                                });
                            }
                        }
                    }
                }
            }
        }

        let mut hyperedge_ids = HashSet::with_capacity(self.support_hyperedges.len());
        for edge in &self.support_hyperedges {
            if !hyperedge_ids.insert(edge.id.as_str()) {
                return Err(HypergraphError::DuplicateHyperedgeId(edge.id.clone()));
            }
            if edge.premises.is_empty() {
                return Err(HypergraphError::EmptyHyperedgePremises(edge.id.clone()));
            }
            if !(0.0..=1.0).contains(&edge.weight) || edge.weight.is_nan() {
                return Err(HypergraphError::InvalidHyperedgeWeight(
                    edge.id.clone(),
                    format!("{}", edge.weight),
                ));
            }
            for p in &edge.premises {
                if !node_ids.contains(p.as_str()) {
                    return Err(HypergraphError::UnknownNodeReference {
                        missing_id: p.clone(),
                        context: format!("support hyperedge '{}' premises", edge.id),
                    });
                }
            }
            if !node_ids.contains(edge.conclusion.as_str()) {
                return Err(HypergraphError::UnknownNodeReference {
                    missing_id: edge.conclusion.clone(),
                    context: format!("support hyperedge '{}' conclusion", edge.id),
                });
            }
        }

        for att in &self.rebutting_attacks {
            if !node_ids.contains(att.attacker.as_str()) {
                return Err(HypergraphError::UnknownNodeReference {
                    missing_id: att.attacker.clone(),
                    context: format!("rebutting attack '{}' attacker", att.id),
                });
            }
            if !node_ids.contains(att.target.as_str()) {
                return Err(HypergraphError::UnknownNodeReference {
                    missing_id: att.target.clone(),
                    context: format!("rebutting attack '{}' target", att.id),
                });
            }
        }

        for und in &self.undercutting_attacks {
            if !node_ids.contains(und.attacker.as_str()) {
                return Err(HypergraphError::UnknownNodeReference {
                    missing_id: und.attacker.clone(),
                    context: format!("undercutting attack '{}' attacker", und.id),
                });
            }
            if !hyperedge_ids.contains(und.target_hyperedge.as_str()) {
                return Err(HypergraphError::UnknownHyperedgeReference {
                    attack_id: und.id.clone(),
                    missing_hyperedge_id: und.target_hyperedge.clone(),
                });
            }
        }

        Ok(())
    }

    /// Returns a map from node ID to index in `self.nodes`.
    pub fn node_index_map(&self) -> HashMap<&str, usize> {
        self.nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect()
    }
}
