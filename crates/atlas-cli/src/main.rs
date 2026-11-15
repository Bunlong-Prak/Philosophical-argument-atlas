use atlas_core::argdown::{parse_argdown, to_argdown};
use atlas_core::dung::solve_hypergraph_dung;
use atlas_core::gradual::{solve_df_quad, GradualSolverConfig};
use atlas_core::knockout::{find_minimal_knockouts, KnockoutConfig};
use atlas_core::model::{ArgumentHypergraph, NodeType};
use std::env;
use std::fs;
use std::process;
use std::time::Instant;

fn print_usage() {
    eprintln!(
        "Argument Atlas CLI (Dialectica Engine v0.1.0)
Usage:
  atlas-cli inspect <path-to-.argdown-or-.json> [--strict-spans] [--json]
  atlas-cli convert <input-path> --to <argdown|json>
"
    );
}

fn load_hypergraph(path: &str) -> Result<ArgumentHypergraph, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read '{path}': {e}"))?;
    if path.ends_with(".json") {
        serde_json::from_str(&raw).map_err(|e| format!("JSON parse error in '{path}': {e}"))
    } else {
        parse_argdown(&raw).map_err(|e| format!("Argdown parse error in '{path}': {e}"))
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        print_usage();
        process::exit(1);
    }

    let subcommand = args[1].as_str();
    let input_path = args[2].as_str();

    match subcommand {
        "inspect" => {
            let strict_spans = args.iter().any(|a| a == "--strict-spans");
            let output_json = args.iter().any(|a| a == "--json");

            let graph = match load_hypergraph(input_path) {
                Ok(g) => g,
                Err(e) => {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }
            };

            if let Err(e) = graph.validate(strict_spans) {
                eprintln!("Validation Error in '{}': {e}", graph.passage_id);
                process::exit(1);
            }

            let t0 = Instant::now();
            let gradual_cfg = GradualSolverConfig::default();
            let gradual_eval = solve_df_quad(&graph, &gradual_cfg).unwrap_or_else(|e| {
                eprintln!("Gradual solver error: {e}");
                process::exit(1);
            });
            let dung_eval = solve_hypergraph_dung(&graph).unwrap_or_else(|e| {
                eprintln!("Dung solver error: {e}");
                process::exit(1);
            });

            // Identify primary Thesis node (or fallback to last node) for Minimal Knockout search.
            let thesis_id = graph
                .nodes
                .iter()
                .find(|n| n.node_type == NodeType::Thesis)
                .or_else(|| graph.nodes.last())
                .map(|n| n.id.clone());

            let knockouts = if let Some(ref tid) = thesis_id {
                find_minimal_knockouts(&graph, &KnockoutConfig::for_target(tid.clone()))
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            let elapsed_us = t0.elapsed().as_micros();

            if output_json {
                let report = serde_json::json!({
                    "passage_id": graph.passage_id,
                    "solve_time_microseconds": elapsed_us,
                    "gradual_df_quad": gradual_eval,
                    "dung_semantics": dung_eval,
                    "thesis_id": thesis_id,
                    "minimal_knockouts": knockouts,
                });
                println!("{}", serde_json::to_string_pretty(&report).unwrap());
                return;
            }

            println!("================================================================================");
            println!(" ARGUMENT ATLAS — DIALECTICAL HYPERGRAPH INSPECTION");
            println!("================================================================================");
            println!(" Passage ID        : {}", graph.passage_id);
            println!(
                " Topology          : {} propositions | {} support hyperedges | {} rebuttals | {} undercutters",
                graph.nodes.len(),
                graph.support_hyperedges.len(),
                graph.rebutting_attacks.len(),
                graph.undercutting_attacks.len()
            );
            println!(
                " Solver Latency    : {} µs (DF-QuAD converged={} in {} iters, residual={:.2e})",
                elapsed_us,
                gradual_eval.converged,
                gradual_eval.iterations,
                gradual_eval.final_residual
            );
            println!("--------------------------------------------------------------------------------");
            println!(" PROPOSITION ACCEPTABILITY (DF-QuAD Gradual vs. Dung Grounded Label)");
            println!("--------------------------------------------------------------------------------");
            for node in &graph.nodes {
                let post = gradual_eval.node_acceptability[&node.id];
                let delta = post - node.base_credence;
                let dung_lbl = dung_eval.grounded_labels[&node.id];
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
                let tau = gradual_eval.hyperedge_transmission[&edge.id];
                println!(
                    " <{:<4}> {:?} +> [{}] (w={:.2}) => effective transmission τ = {:.4}",
                    edge.id, edge.premises, edge.conclusion, edge.weight, tau
                );
            }

            println!("--------------------------------------------------------------------------------");
            println!(" DUNG EXTENSIONS");
            println!("--------------------------------------------------------------------------------");
            println!(" Grounded Extension  : {:?}", dung_eval.grounded);
            println!(" Preferred Extensions: {:?}", dung_eval.preferred);
            println!(" Stable Extensions   : {:?}", dung_eval.stable);

            if let Some(tid) = thesis_id {
                println!("--------------------------------------------------------------------------------");
                println!(" MINIMAL PREMISE KNOCKOUTS FOR THESIS [{tid}] (Threshold <= 0.50)");
                println!("--------------------------------------------------------------------------------");
                if knockouts.is_empty() {
                    println!(" (No eligible premise subset of size <= 4 collapses [{tid}] to <= 0.50)");
                } else {
                    for (rank, ko) in knockouts.iter().enumerate() {
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
        "convert" => {
            let to_format = args
                .windows(2)
                .find(|w| w[0] == "--to")
                .map(|w| w[1].as_str())
                .unwrap_or("json");

            let graph = match load_hypergraph(input_path) {
                Ok(g) => g,
                Err(e) => {
                    eprintln!("Error: {e}");
                    process::exit(1);
                }
            };

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
