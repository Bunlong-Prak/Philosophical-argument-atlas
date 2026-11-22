export type NodeType =
  | "thesis"
  | "explicit_premise"
  | "enthymeme"
  | "objection"
  | "counterfactual_assumption";

export interface TextSpan {
  start_char: number;
  end_char: number;
  verbatim_quote: string;
}

export interface PropositionNode {
  id: string;
  proposition: string;
  node_type: NodeType;
  span: TextSpan | null;
  speaker: string | null;
  base_credence: number;
}

export interface SupportHyperedge {
  id: string;
  premises: string[];
  conclusion: string;
  weight: number;
  scheme: string | Record<string, string> | null;
}

export interface RebuttingAttack {
  id: string;
  attacker: string;
  target: string;
  weight: number;
}

export interface UndercuttingAttack {
  id: string;
  attacker: string;
  target_hyperedge: string;
  weight: number;
}

export interface ArgumentHypergraph {
  passage_id: string;
  source_text: string | null;
  nodes: PropositionNode[];
  support_hyperedges: SupportHyperedge[];
  rebutting_attacks: RebuttingAttack[];
  undercutting_attacks: UndercuttingAttack[];
}

export interface GradualEvaluation {
  node_acceptability: Record<string, number>;
  hyperedge_transmission: Record<string, number>;
  iterations: number;
  final_residual: number;
  converged: boolean;
}

export interface DungSemanticsResult {
  grounded: string[];
  preferred: string[][];
  stable: string[][];
  grounded_labels: Record<string, "in" | "out" | "undecided">;
  compiled_argument_count: number;
  compiled_attack_count: number;
}

export interface MinimalKnockout {
  removed_node_ids: string[];
  cardinality: number;
  credence_cost: number;
  baseline_acceptability: number;
  post_knockout_acceptability: number;
  acceptability_drop: number;
}

export interface SolverReport {
  passage_id: string;
  solve_time_microseconds: number;
  gradual_df_quad: GradualEvaluation;
  dung_semantics: DungSemanticsResult;
  thesis_id: string | null;
  minimal_knockouts: MinimalKnockout[];
}

export interface PassageSummary {
  passage_id: string;
  filename: string;
  node_count: number;
  support_count: number;
  rebuttal_count: number;
  undercutter_count: number;
  source_preview: string;
}

export interface PassageDetail {
  passage_id: string;
  filename: string;
  argdown: string;
  hypergraph: ArgumentHypergraph;
  report: SolverReport;
}

export interface EnthymemeScoreBreakdown {
  candidate: string;
  p_entail_base: number;
  p_entail_with_e: number;
  delta_nli: number;
  p_contradict_with_e: number;
  usurpation_nli: number;
  reverse_entail_nli: number;
  conclusion_sim: number;
  usurpation_score: number;
  material_conditional_sim: number;
  novel_content_ratio: number;
  triviality_penalty: number;
  final_score: number;
  verdict: string;
}
