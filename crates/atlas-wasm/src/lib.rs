use atlas_core::argdown::parse_argdown;
use atlas_core::dung::solve_hypergraph_dung;
use atlas_core::gradual::{solve_df_quad, ConjunctiveNorm, GradualSolverConfig};
use atlas_core::knockout::{find_minimal_knockouts, KnockoutConfig};
use atlas_core::model::{ArgumentHypergraph, NodeType};
use std::cell::RefCell;
use std::slice;

thread_local! {
    static LAST_RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_last_result(text: String) {
    LAST_RESULT.with(|cell| {
        *cell.borrow_mut() = text.into_bytes();
    });
}

fn evaluate_to_report_json(
    graph: &ArgumentHypergraph,
    strict_spans: bool,
    collapse_threshold: f64,
    t_norm: ConjunctiveNorm,
) -> Result<serde_json::Value, String> {
    graph
        .validate(strict_spans)
        .map_err(|e| format!("Validation Error in '{}': {e}", graph.passage_id))?;

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

    Ok(serde_json::json!({
        "passage_id": graph.passage_id,
        "solve_time_microseconds": 0,
        "gradual_df_quad": gradual_eval,
        "dung_semantics": dung_eval,
        "thesis_id": thesis_id,
        "minimal_knockouts": knockouts,
    }))
}

/// Allocates a linear byte buffer of capacity `len` inside Wasm memory.
#[no_mangle]
pub extern "C" fn atlas_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::dangling().as_ptr();
    }
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a byte buffer previously allocated with `atlas_alloc`.
///
/// # Safety
/// `ptr` and `cap` must match an active allocation returned by `atlas_alloc`.
#[no_mangle]
pub unsafe extern "C" fn atlas_dealloc(ptr: *mut u8, cap: usize) {
    if cap == 0 || ptr.is_null() {
        return;
    }
    drop(Vec::from_raw_parts(ptr, 0, cap));
}

/// Pointer to the latest UTF-8 response payload written by `atlas_solve_json` or `atlas_parse_argdown`.
#[no_mangle]
pub extern "C" fn atlas_result_ptr() -> *const u8 {
    LAST_RESULT.with(|cell| cell.borrow().as_ptr())
}

/// Byte length of the latest UTF-8 response payload.
#[no_mangle]
pub extern "C" fn atlas_result_len() -> usize {
    LAST_RESULT.with(|cell| cell.borrow().len())
}

/// Solves a JSON-serialized `ArgumentHypergraph` in-memory.
/// Returns `0` on success (JSON `SolverReport` in result buffer) or `1` on error.
///
/// # Safety
/// `in_ptr` must point to `in_len` readable bytes of UTF-8 text.
#[no_mangle]
pub unsafe extern "C" fn atlas_solve_json(
    in_ptr: *const u8,
    in_len: usize,
    strict_spans: u32,
    threshold: f64,
    use_product: u32,
) -> i32 {
    let bytes = if in_len == 0 {
        &[]
    } else {
        slice::from_raw_parts(in_ptr, in_len)
    };
    let raw = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            set_last_result(format!("Invalid UTF-8 input: {e}"));
            return 1;
        }
    };
    let graph: ArgumentHypergraph = match serde_json::from_str(raw) {
        Ok(g) => g,
        Err(e) => {
            set_last_result(format!("JSON parse error: {e}"));
            return 1;
        }
    };
    let norm = if use_product != 0 {
        ConjunctiveNorm::Product
    } else {
        ConjunctiveNorm::GodelMinimum
    };

    match evaluate_to_report_json(&graph, strict_spans != 0, threshold, norm) {
        Ok(val) => {
            set_last_result(val.to_string());
            0
        }
        Err(msg) => {
            set_last_result(msg);
            1
        }
    }
}

/// Parses raw `.argdown` text and solves it in-memory.
/// Returns `0` on success (JSON `PassageDetail` in result buffer) or `1` on error.
///
/// # Safety
/// `in_ptr` must point to `in_len` readable bytes of UTF-8 text.
#[no_mangle]
pub unsafe extern "C" fn atlas_parse_argdown(
    in_ptr: *const u8,
    in_len: usize,
    strict_spans: u32,
    threshold: f64,
    use_product: u32,
) -> i32 {
    let bytes = if in_len == 0 {
        &[]
    } else {
        slice::from_raw_parts(in_ptr, in_len)
    };
    let raw = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            set_last_result(format!("Invalid UTF-8 input: {e}"));
            return 1;
        }
    };
    let graph = match parse_argdown(raw) {
        Ok(g) => g,
        Err(e) => {
            set_last_result(format!("Argdown parse error: {e}"));
            return 1;
        }
    };
    let check_strict = (strict_spans != 0) && graph.source_text.is_some();
    let norm = if use_product != 0 {
        ConjunctiveNorm::Product
    } else {
        ConjunctiveNorm::GodelMinimum
    };

    match evaluate_to_report_json(&graph, check_strict, threshold, norm) {
        Ok(report) => {
            let detail = serde_json::json!({
                "passage_id": graph.passage_id,
                "filename": format!("{}.argdown", graph.passage_id),
                "argdown": raw,
                "hypergraph": graph,
                "report": report,
            });
            set_last_result(detail.to_string());
            0
        }
        Err(msg) => {
            set_last_result(msg);
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_abi_parse_and_solve_roundtrip() {
        let sample = r#"---
passage_id: wasm-test
source_text: "I think, therefore I am."
---

# Propositions
[P1]: Thinking occurs. {type: explicit_premise, credence: 0.9000, span: 0..7, quote: "I think"}
[E1]: Thinking things exist. {type: enthymeme, credence: 0.8000}
[C]: I exist. {type: thesis, credence: 0.0000, span: 19..23, quote: "I am"}

# Support Hyperedges
<H1>: [P1] & [E1] +> [C] {weight: 1.0000, scheme: modus_ponens}
"#;
        let bytes = sample.as_bytes();
        unsafe {
            let buf = atlas_alloc(bytes.len());
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, bytes.len());
            let rc = atlas_parse_argdown(buf, bytes.len(), 1, 0.5, 0);
            atlas_dealloc(buf, bytes.len());
            assert_eq!(rc, 0);

            let out_slice = slice::from_raw_parts(atlas_result_ptr(), atlas_result_len());
            let parsed: serde_json::Value = serde_json::from_slice(out_slice).unwrap();
            assert_eq!(parsed["passage_id"], "wasm-test");
            let c_score = parsed["report"]["gradual_df_quad"]["node_acceptability"]["C"]
                .as_f64()
                .unwrap();
            assert!((c_score - 0.80).abs() < 1e-6);

            let graph_str = parsed["hypergraph"].to_string();
            let g_bytes = graph_str.as_bytes();
            let g_buf = atlas_alloc(g_bytes.len());
            std::ptr::copy_nonoverlapping(g_bytes.as_ptr(), g_buf, g_bytes.len());
            let rc_prod = atlas_solve_json(g_buf, g_bytes.len(), 1, 0.5, 1);
            atlas_dealloc(g_buf, g_bytes.len());
            assert_eq!(rc_prod, 0);

            let prod_slice = slice::from_raw_parts(atlas_result_ptr(), atlas_result_len());
            let prod_rep: serde_json::Value = serde_json::from_slice(prod_slice).unwrap();
            let prod_score = prod_rep["gradual_df_quad"]["node_acceptability"]["C"]
                .as_f64()
                .unwrap();
            assert!((prod_score - 0.72).abs() < 1e-6);
        }
    }
}
