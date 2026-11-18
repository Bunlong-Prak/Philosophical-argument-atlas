use atlas_core::argdown::{parse_argdown, to_argdown};
use atlas_core::dung::solve_hypergraph_dung;
use atlas_core::gradual::{solve_df_quad, ConjunctiveNorm, GradualSolverConfig};
use atlas_core::knockout::{find_minimal_knockouts, KnockoutConfig};
use atlas_core::model::{ArgumentHypergraph, NodeType};
use std::env;
use std::fs;
use std::io::{self, Read};
use std::process;
use std::time::Instant;

fn print_usage() {
    eprintln!(
        "Argument Atlas CLI (Dialectica Engine v0.1.0)
Usage:
  atlas-cli inspect <path-to-.argdown-or-.json> [--strict-spans] [--json]
  atlas-cli solve [--stdin | <path-to-.argdown-or-.json>] [--strict-spans] [--threshold <f64>] [--t-norm <godel|product>]
  atlas-cli convert <input-path> --to <argdown|json>
"
    );
}

fn load_hypergraph_from_path(path: &str) -> Result<ArgumentHypergraph, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read '{path}': {e}"))?;
    if path.ends_with(".json") {
        serde_json::from_str(&raw).map_err(|e| format!("JSON parse error in '{path}': {e}"))
    } else {
        parse_argdown(&raw).map_err(|e| format!("Argdown parse error in '{path}': {e}"))
    }
}

fn parse_flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2).find(|w| w[0] == flag).map(|w| w[1].as_str())
}

struct EvaluationReport {
    passage_id: String,
    elapsed_us: u128,
    gradual_eval: atlas_core::gradual::GradualEvaluation,
    dung_eval: atlas_core::dung::HypergraphDungResult,
    thesis_id: Option<String>,
    knockouts: Vec<atlas_core::knockout::MinimalKnockout>,
}

fn evaluate_hypergraph(
    graph: &ArgumentHypergraph,
    strict_spans: bool,
    collapse_threshold: f64,
    t_norm: ConjunctiveNorm,
) -> Result<EvaluationReport, String> {
    graph
        .validate(strict_spans)
        .map_err(|e| format!("Validation Error in '{}': {e}", graph.passage_id))?;

    let t0 = Instant::now();
    let gradual_cfg = GradualSolverConfig {
        t_norm,
        ..Default::default()
    };
    let gradual_eval =
        solve_df_quad(graph, &gradual_cfg).map_err(|e| format!("Gradual solver error: {e}"))?;
    let dung_eval =
        solve_hypergraph_dung(graph).map_err(|e| format!("Dung solver error: {e}"))?;

    let thesis_id = graph
        .nodes
        .iter()
        .find(|n| n.node_type == NodeType::Thesis)
        .or_else(|| graph.nodes.last())
        .map(|n| n.id.clone());

    let knockouts = if let Some(ref tid) = thesis_id {
        let mut ko_cfg = KnockoutConfig::for_target(tid.clone());
        ko_cfg.collapse_threshold = collapse_threshold;
        ko_cfg.solver_config = gradual_cfg;
        find_minimal_knockouts(graph, &ko_cfg).unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(EvaluationReport {
        passage_id: graph.passage_id.clone(),
        elapsed_us: t0.elapsed().as_micros(),
        gradual_eval,
        dung_eval,
        thesis_id,
        knockouts,
    })
}

fn report_to_json(report: &EvaluationReport) -> serde_json::Value {
    serde_json::json!({
        "passage_id": report.passage_id,
        "solve_time_microseconds": report.elapsed_us,
        "gradual_df_quad": report.gradual_eval,
        "dung_semantics": report.dung_eval,
        "thesis_id": report.thesis_id,
        "minimal_knockouts": report.knockouts,
    })
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    let subcommand = args[1].as_str();

    match subcommand {
        "inspect" => {
            if args.len() < 3 {
                print_usage();
                process::exit(1);
            }
            let input_path = args[2].as_str();
            let strict_spans = args.iter().any(|a| a == "--strict-spans");
            let output_json = args.iter().any(|a| a == "--json");

            let graph = load_hypergraph_from_path(input_path).unwrap_or_else(|e| {
                eprintln!("Error: {e}");
                process::exit(1);
            });

            let report = evaluate_hypergraph(&graph, strict_spans, 0.50, ConjunctiveNorm::GodelMinimum)
                .unwrap_or_else(|e| {
                    eprintln!("{e}");
                    process::exit(1);
                });

            if output_json {
                println!("{}", serde_json::to_string_pretty(&report_to_json(&report)).unwrap());
                return;
            }

            println!("================================================================================");
            println!(" ARGUMENT ATLAS — DIALECTICAL HYPERGRAPH INSPECTION");
            println!("================================================================================");
            println!(" Passage ID        : {}", report.passage_id);
            println!(
                " Topology          : {} propositions | {} support hyperedges | {} rebuttals | {} undercutters",
                graph.nodes.len(),
                graph.support_hyperedges.len(),
                graph.rebutting_attacks.len(),
                graph.undercutting_attacks.len()
            );
            println!(
                " Solver Latency    : {} µs (DF-QuAD converged={} in {} iters, residual={:.2e})",
                report.elapsed_us,
                report.gradual_eval.converged,
                report.gradual_eval.iterations,
                report.gradual_eval.final_residual
            );
            println!("--------------------------------------------------------------------------------");
            println!(" PROPOSITION ACCEPTABILITY (DF-QuAD Gradual vs. Dung Grounded Label)");
            println!("--------------------------------------------------------------------------------");
            for node in &graph.nodes {
                let post = report.gradual_eval.node_acceptability[&node.id];
                let delta = post - node.base_credence;
                let dung_lbl = report.dung_eval.grounded_labels[&node.id];
                println!(
                    " [{:<4}] ({:<18}) prior={:.2} -> posterior={:.4} ({:+.4}) | Dung={:?}",
                    node.id,
                    format!("{:?}", node.node_type),
                    node.base_credence,
                    post,
                    delta,
                    dung_lbl
                );
                println!("        \"{}\"", node.proposition);
            }

            println!("--------------------------------------------------------------------------------");
            println!(" SUPPORT HYPEREDGE TRANSMISSION");
            println!("--------------------------------------------------------------------------------");
            for edge in &graph.support_hyperedges {
                let tau = report.gradual_eval.hyperedge_transmission[&edge.id];
                println!(
                    " <{:<4}> {:?} +> [{}] (w={:.2}) => effective transmission τ = {:.4}",
                    edge.id, edge.premises, edge.conclusion, edge.weight, tau
                );
            }

            println!("--------------------------------------------------------------------------------");
            println!(" DUNG EXTENSIONS");
            println!("--------------------------------------------------------------------------------");
            println!(" Grounded Extension  : {:?}", report.dung_eval.grounded);
            println!(" Preferred Extensions: {:?}", report.dung_eval.preferred);
            println!(" Stable Extensions   : {:?}", report.dung_eval.stable);

            if let Some(ref tid) = report.thesis_id {
                println!("--------------------------------------------------------------------------------");
                println!(" MINIMAL PREMISE KNOCKOUTS FOR THESIS [{tid}] (Threshold <= 0.50)");
                println!("--------------------------------------------------------------------------------");
                if report.knockouts.is_empty() {
                    println!(" (No eligible premise subset of size <= 4 collapses [{tid}] to <= 0.50)");
                } else {
                    for (rank, ko) in report.knockouts.iter().enumerate() {
                        println!(
                            " #{:<2} Remove {:?} | epistemic_cost={:.2} | [{tid}]: {:.4} -> {:.4} (drop={:.4})",
                            rank + 1,
                            ko.removed_node_ids,
                            ko.credence_cost,
                            ko.baseline_acceptability,
                            ko.post_knockout_acceptability,
                            ko.acceptability_drop
                        );
                    }
                }
            }
            println!("================================================================================");
        }
        "solve" => {
            let strict_spans = args.iter().any(|a| a == "--strict-spans");
            let use_stdin = args.iter().any(|a| a == "--stdin");
            let threshold = parse_flag_value(&args, "--threshold")
                .map(|v| {
                    v.parse::<f64>().unwrap_or_else(|_| {
                        eprintln!("Invalid --threshold value '{v}'");
                        process::exit(1);
                    })
                })
                .unwrap_or(0.50);
            let t_norm = match parse_flag_value(&args, "--t-norm").unwrap_or("godel") {
                "godel" => ConjunctiveNorm::GodelMinimum,
                "product" => ConjunctiveNorm::Product,
                other => {
                    eprintln!("Unknown --t-norm '{other}'. Expected 'godel' or 'product'.");
                    process::exit(1);
                }
            };

            let graph = if use_stdin {
                let mut buf = String::new();
                io::stdin().read_to_string(&mut buf).unwrap_or_else(|e| {
                    eprintln!("Failed to read stdin: {e}");
                    process::exit(1);
                });
                let trimmed = buf.trim();
                if trimmed.starts_with('{') {
                    serde_json::from_str(trimmed).unwrap_or_else(|e| {
                        eprintln!("JSON parse error from stdin: {e}");
                        process::exit(1);
                    })
                } else {
                    parse_argdown(trimmed).unwrap_or_else(|e| {
                        eprintln!("Argdown parse error from stdin: {e}");
                        process::exit(1);
                    })
                }
            } else if args.len() >= 3 && !args[2].starts_with("--") {
                load_hypergraph_from_path(&args[2]).unwrap_or_else(|e| {
                    eprintln!("Error: {e}");
                    process::exit(1);
                })
            } else {
                print_usage();
                process::exit(1);
            };

            let report = evaluate_hypergraph(&graph, strict_spans, threshold, t_norm)
                .unwrap_or_else(|e| {
                    eprintln!("{e}");
                    process::exit(1);
                });
            println!("{}", serde_json::to_string(&report_to_json(&report)).unwrap());
        }
        "convert" => {
            if args.len() < 3 {
                print_usage();
                process::exit(1);
            }
            let input_path = args[2].as_str();
            let to_format = parse_flag_value(&args, "--to").unwrap_or("json");

            let graph = load_hypergraph_from_path(input_path).unwrap_or_else(|e| {
                eprintln!("Error: {e}");
                process::exit(1);
            });

            match to_format {
                "json" => println!("{}", serde_json::to_string_pretty(&graph).unwrap()),
                "argdown" => print!("{}", to_argdown(&graph)),
                other => {
                    eprintln!("Unknown target format '{other}'. Expected 'argdown' or 'json'.");
                    process::exit(1);
                }
            }
        }
        _ => {
            print_usage();
            process::exit(1);
        }
    }
}
