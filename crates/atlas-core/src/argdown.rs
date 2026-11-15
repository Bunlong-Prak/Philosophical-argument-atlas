use crate::model::{
    ArgumentHypergraph, ArgumentationScheme, NodeType, PropositionNode, RebuttingAttack,
    SupportHyperedge, TextSpan, UndercuttingAttack,
};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ArgdownError {
    #[error("Line {line}: {message}")]
    ParseError { line: usize, message: String },
}

/// Exports an `ArgumentHypergraph` into a human-readable, lossless `.argdown` document.
pub fn to_argdown(graph: &ArgumentHypergraph) -> String {
    let mut out = String::new();

    out.push_str("---\n");
    out.push_str(&format!("passage_id: {}\n", graph.passage_id));
    if let Some(ref src) = graph.source_text {
        let escaped = src.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        out.push_str(&format!("source_text: \"{escaped}\"\n"));
    }
    out.push_str("---\n\n");

    out.push_str("# Propositions\n");
    for node in &graph.nodes {
        let type_str = node_type_to_str(node.node_type);
        let mut meta_parts = vec![
            format!("type: {type_str}"),
            format!("credence: {:.4}", node.base_credence),
        ];
        if let Some(ref spk) = node.speaker {
            let escaped = spk.replace('"', "\\\"");
            meta_parts.push(format!("speaker: \"{escaped}\""));
        }
        if let Some(ref span) = node.span {
            let escaped_q = span
                .verbatim_quote
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
                .replace('\n', "\\n");
            meta_parts.push(format!("span: {}..{}", span.start_char, span.end_char));
            meta_parts.push(format!("quote: \"{escaped_q}\""));
        }
        let meta = meta_parts.join(", ");
        out.push_str(&format!(
            "[{}]: {} {{{}}}\n",
            node.id, node.proposition, meta
        ));
    }

    if !graph.support_hyperedges.is_empty() {
        out.push_str("\n# Support Hyperedges\n");
        for edge in &graph.support_hyperedges {
            let premises_str = edge
                .premises
                .iter()
                .map(|p| format!("[{p}]"))
                .collect::<Vec<_>>()
                .join(" & ");
            let mut meta_parts = vec![format!("weight: {:.4}", edge.weight)];
            if let Some(ref scheme) = edge.scheme {
                meta_parts.push(format!("scheme: {}", scheme_to_str(scheme)));
            }
            out.push_str(&format!(
                "<{}>: {} +> [{}] {{{}}}\n",
                edge.id,
                premises_str,
                edge.conclusion,
                meta_parts.join(", ")
            ));
        }
    }

    if !graph.rebutting_attacks.is_empty() {
        out.push_str("\n# Rebutting Attacks\n");
        for att in &graph.rebutting_attacks {
            out.push_str(&format!(
                "<{}>: [{}] -> [{}] {{weight: {:.4}}}\n",
                att.id, att.attacker, att.target, att.weight
            ));
        }
    }

    if !graph.undercutting_attacks.is_empty() {
        out.push_str("\n# Undercutting Attacks\n");
        for und in &graph.undercutting_attacks {
            out.push_str(&format!(
                "<{}>: [{}] _> <{}> {{weight: {:.4}}}\n",
                und.id, und.attacker, und.target_hyperedge, und.weight
            ));
        }
    }

    out
}

/// Parses an extended `.argdown` document into an `ArgumentHypergraph`.
pub fn parse_argdown(input: &str) -> Result<ArgumentHypergraph, ArgdownError> {
    let mut passage_id = "unnamed-passage".to_string();
    let mut source_text: Option<String> = None;
    let mut nodes = Vec::new();
    let mut support_hyperedges = Vec::new();
    let mut rebutting_attacks = Vec::new();
    let mut undercutting_attacks = Vec::new();

    let mut in_frontmatter = false;
    let mut frontmatter_done = false;
    let mut auto_edge_counter = 1usize;

    for (idx, raw_line) in input.lines().enumerate() {
        let line_num = idx + 1;
        let line = raw_line.trim();

        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }

        if line == "---" {
            if !in_frontmatter && !frontmatter_done {
                in_frontmatter = true;
                continue;
            } else if in_frontmatter {
                in_frontmatter = false;
                frontmatter_done = true;
                continue;
            }
        }

        if in_frontmatter {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim();
                let val = v.trim();
                match key {
                    "passage_id" => passage_id = unquote(val),
                    "source_text" => source_text = Some(unquote(val)),
                    _ => {}
                }
            }
            continue;
        }

        let (body, meta_map) = split_metadata(line, line_num)?;

        // 1. Check if line is a relation (`+>`, `->`, `_>`)
        if body.contains("+>") {
            let edge = parse_support_line(body, &meta_map, &mut auto_edge_counter, line_num)?;
            support_hyperedges.push(edge);
        } else if body.contains("_>") {
            let und = parse_undercut_line(body, &meta_map, &mut auto_edge_counter, line_num)?;
            undercutting_attacks.push(und);
        } else if body.contains("->") {
            let att = parse_rebuttal_line(body, &meta_map, &mut auto_edge_counter, line_num)?;
            rebutting_attacks.push(att);
        } else if body.starts_with('[') {
            let node = parse_node_line(body, &meta_map, line_num)?;
            nodes.push(node);
        } else {
            return Err(ArgdownError::ParseError {
                line: line_num,
                message: format!("Unrecognized Argdown statement: '{line}'"),
            });
        }
    }

    Ok(ArgumentHypergraph {
        passage_id,
        source_text,
        nodes,
        support_hyperedges,
        rebutting_attacks,
        undercutting_attacks,
    })
}

fn parse_node_line(
    body: &str,
    meta: &HashMap<String, String>,
    line_num: usize,
) -> Result<PropositionNode, ArgdownError> {
    let close_bracket = body.find("]:").ok_or_else(|| ArgdownError::ParseError {
        line: line_num,
        message: "Expected '[ID]: Proposition text'".to_string(),
    })?;
    let id = body[1..close_bracket].trim().to_string();
    let proposition = body[close_bracket + 2..].trim().to_string();

    let node_type = meta
        .get("type")
        .map(|s| parse_node_type(s, line_num))
        .transpose()?
        .unwrap_or(NodeType::ExplicitPremise);

    let base_credence = meta
        .get("credence")
        .map(|s| {
            s.parse::<f64>().map_err(|_| ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid credence float: '{s}'"),
            })
        })
        .transpose()?
        .unwrap_or(0.80);

    let speaker = meta.get("speaker").cloned();

    let span = if let Some(span_str) = meta.get("span") {
        let (start_s, end_s) = span_str.split_once("..").ok_or_else(|| {
            ArgdownError::ParseError {
                line: line_num,
                message: format!("Expected span format 'start..end', got '{span_str}'"),
            }
        })?;
        let start_char = start_s.trim().parse::<usize>().map_err(|_| {
            ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid span start: '{start_s}'"),
            }
        })?;
        let end_char = end_s.trim().parse::<usize>().map_err(|_| {
            ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid span end: '{end_s}'"),
            }
        })?;
        let verbatim_quote = meta.get("quote").cloned().unwrap_or_default();
        Some(TextSpan {
            start_char,
            end_char,
            verbatim_quote,
        })
    } else {
        None
    };

    Ok(PropositionNode {
        id,
        proposition,
        node_type,
        span,
        speaker,
        base_credence,
    })
}

fn parse_support_line(
    body: &str,
    meta: &HashMap<String, String>,
    counter: &mut usize,
    line_num: usize,
) -> Result<SupportHyperedge, ArgdownError> {
    let (edge_id, rest) = extract_optional_angle_id(body, "H", counter);
    let (lhs, rhs) = rest.split_once("+>").ok_or_else(|| ArgdownError::ParseError {
        line: line_num,
        message: "Expected '+>' in support hyperedge".to_string(),
    })?;

    let mut premises = Vec::new();
    for part in lhs.split('&') {
        premises.push(extract_bracket_id(part.trim(), line_num)?);
    }
    let conclusion = extract_bracket_id(rhs.trim(), line_num)?;

    let weight = meta
        .get("weight")
        .map(|s| {
            s.parse::<f64>().map_err(|_| ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid weight float: '{s}'"),
            })
        })
        .transpose()?
        .unwrap_or(1.0);

    let scheme = meta.get("scheme").map(|s| parse_scheme(s));

    Ok(SupportHyperedge {
        id: edge_id,
        premises,
        conclusion,
        weight,
        scheme,
    })
}

fn parse_rebuttal_line(
    body: &str,
    meta: &HashMap<String, String>,
    counter: &mut usize,
    line_num: usize,
) -> Result<RebuttingAttack, ArgdownError> {
    let (att_id, rest) = extract_optional_angle_id(body, "R", counter);
    let (lhs, rhs) = rest.split_once("->").ok_or_else(|| ArgdownError::ParseError {
        line: line_num,
        message: "Expected '->' in rebutting attack".to_string(),
    })?;

    let attacker = extract_bracket_id(lhs.trim(), line_num)?;
    let target = extract_bracket_id(rhs.trim(), line_num)?;
    let weight = meta
        .get("weight")
        .map(|s| {
            s.parse::<f64>().map_err(|_| ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid weight float: '{s}'"),
            })
        })
        .transpose()?
        .unwrap_or(1.0);

    Ok(RebuttingAttack {
        id: att_id,
        attacker,
        target,
        weight,
    })
}

fn parse_undercut_line(
    body: &str,
    meta: &HashMap<String, String>,
    counter: &mut usize,
    line_num: usize,
) -> Result<UndercuttingAttack, ArgdownError> {
    let (und_id, rest) = extract_optional_angle_id(body, "UND", counter);
    let (lhs, rhs) = rest.split_once("_>").ok_or_else(|| ArgdownError::ParseError {
        line: line_num,
        message: "Expected '_>' in undercutting attack".to_string(),
    })?;

    let attacker = extract_bracket_id(lhs.trim(), line_num)?;
    let target_hyperedge = extract_angle_id(rhs.trim(), line_num)?;
    let weight = meta
        .get("weight")
        .map(|s| {
            s.parse::<f64>().map_err(|_| ArgdownError::ParseError {
                line: line_num,
                message: format!("Invalid weight float: '{s}'"),
            })
        })
        .transpose()?
        .unwrap_or(1.0);

    Ok(UndercuttingAttack {
        id: und_id,
        attacker,
        target_hyperedge,
        weight,
    })
}

fn extract_optional_angle_id<'a>(
    body: &'a str,
    prefix: &str,
    counter: &mut usize,
) -> (String, &'a str) {
    if let Some( rest_after_open) = body.strip_prefix('<') {
        if let Some((id, rem)) = rest_after_open.split_once(">:") {
            return (id.trim().to_string(), rem.trim());
        }
    }
    let id = format!("{prefix}{counter}");
    *counter += 1;
    (id, body)
}

fn extract_bracket_id(token: &str, line_num: usize) -> Result<String, ArgdownError> {
    if let Some(inner) = token.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        let trimmed = inner.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Err(ArgdownError::ParseError {
        line: line_num,
        message: format!("Expected bracketed proposition ID '[ID]', found '{token}'"),
    })
}

fn extract_angle_id(token: &str, line_num: usize) -> Result<String, ArgdownError> {
    if let Some(inner) = token.strip_prefix('<').and_then(|s| s.strip_suffix('>')) {
        let trimmed = inner.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    Err(ArgdownError::ParseError {
        line: line_num,
        message: format!("Expected angle-bracketed hyperedge ID '<ID>', found '{token}'"),
    })
}

fn split_metadata(
    line: &str,
    line_num: usize,
) -> Result<(&str, HashMap<String, String>), ArgdownError> {
    if !line.ends_with('}') {
        return Ok((line, HashMap::new()));
    }
    // Find the opening '{' that starts the trailing metadata block (outside quotes).
    let mut in_quotes = false;
    let mut prev_backslash = false;
    let mut open_brace_idx = None;

    for (i, ch) in line.char_indices() {
        if ch == '"' && !prev_backslash {
            in_quotes = !in_quotes;
        }
        if ch == '{' && !in_quotes {
            open_brace_idx = Some(i);
        }
        prev_backslash = ch == '\\' && !prev_backslash;
    }

    let Some(open_idx) = open_brace_idx else {
        return Err(ArgdownError::ParseError {
            line: line_num,
            message: "Unmatched closing '}' in metadata block".to_string(),
        });
    };

    let body = line[..open_idx].trim();
    let meta_raw = &line[open_idx + 1..line.len() - 1];
    let mut map = HashMap::new();

    for entry in split_comma_respecting_quotes(meta_raw) {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }
        let (k, v) = entry.split_once(':').ok_or_else(|| ArgdownError::ParseError {
            line: line_num,
            message: format!("Invalid metadata key:value pair '{entry}'"),
        })?;
        map.insert(k.trim().to_string(), unquote(v.trim()));
    }

    Ok((body, map))
}

fn split_comma_respecting_quotes(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut in_quotes = false;
    let mut prev_backslash = false;

    for (i, ch) in s.char_indices() {
        if ch == '"' && !prev_backslash {
            in_quotes = !in_quotes;
        } else if ch == ',' && !in_quotes {
            parts.push(&s[start..i]);
            start = i + 1;
        }
        prev_backslash = ch == '\\' && !prev_backslash;
    }
    parts.push(&s[start..]);
    parts
}

fn unquote(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        inner
            .replace("\\n", "\n")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    } else {
        trimmed.to_string()
    }
}

fn node_type_to_str(nt: NodeType) -> &'static str {
    match nt {
        NodeType::Thesis => "thesis",
        NodeType::ExplicitPremise => "explicit_premise",
        NodeType::Enthymeme => "enthymeme",
        NodeType::Objection => "objection",
        NodeType::CounterfactualAssumption => "counterfactual_assumption",
    }
}

fn parse_node_type(s: &str, line_num: usize) -> Result<NodeType, ArgdownError> {
    match s.trim() {
        "thesis" => Ok(NodeType::Thesis),
        "explicit_premise" | "premise" => Ok(NodeType::ExplicitPremise),
        "enthymeme" | "implicit_premise" => Ok(NodeType::Enthymeme),
        "objection" => Ok(NodeType::Objection),
        "counterfactual_assumption" | "counterfactual" => Ok(NodeType::CounterfactualAssumption),
        other => Err(ArgdownError::ParseError {
            line: line_num,
            message: format!("Unknown node type: '{other}'"),
        }),
    }
}

fn scheme_to_str(scheme: &ArgumentationScheme) -> String {
    match scheme {
        ArgumentationScheme::ModusPonens => "modus_ponens".to_string(),
        ArgumentationScheme::ModusTollens => "modus_tollens".to_string(),
        ArgumentationScheme::DisjunctiveSyllogism => "disjunctive_syllogism".to_string(),
        ArgumentationScheme::ReductioAdAbsurdum => "reductio_ad_absurdum".to_string(),
        ArgumentationScheme::TranscendentalDeduction => "transcendental_deduction".to_string(),
        ArgumentationScheme::Analogy => "analogy".to_string(),
        ArgumentationScheme::CausalToEffect => "causal_to_effect".to_string(),
        ArgumentationScheme::Consequence => "consequence".to_string(),
        ArgumentationScheme::SignOrEvidence => "sign_or_evidence".to_string(),
        ArgumentationScheme::DefeasibleGeneralization => "defeasible_generalization".to_string(),
        ArgumentationScheme::PracticalReasoning => "practical_reasoning".to_string(),
        ArgumentationScheme::Custom(s) => s.clone(),
    }
}

fn parse_scheme(s: &str) -> ArgumentationScheme {
    match s.trim() {
        "modus_ponens" => ArgumentationScheme::ModusPonens,
        "modus_tollens" => ArgumentationScheme::ModusTollens,
        "disjunctive_syllogism" => ArgumentationScheme::DisjunctiveSyllogism,
        "reductio_ad_absurdum" => ArgumentationScheme::ReductioAdAbsurdum,
        "transcendental_deduction" => ArgumentationScheme::TranscendentalDeduction,
        "analogy" => ArgumentationScheme::Analogy,
        "causal_to_effect" => ArgumentationScheme::CausalToEffect,
        "consequence" => ArgumentationScheme::Consequence,
        "sign_or_evidence" => ArgumentationScheme::SignOrEvidence,
        "defeasible_generalization" => ArgumentationScheme::DefeasibleGeneralization,
        "practical_reasoning" => ArgumentationScheme::PracticalReasoning,
        other => ArgumentationScheme::Custom(other.to_string()),
    }
}
