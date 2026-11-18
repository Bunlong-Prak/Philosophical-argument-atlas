# Philosophy Argument Atlas (Dialectica Engine)

[![Rust](https://img.shields.io/badge/Rust-2021-orange?logo=rust)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Research Prototype](https://img.shields.io/badge/Status-Active_Research-emerald)](#roadmap)

> **A Neuro-Symbolic Dialectical & Enthymematic Reasoning Workbench for Computational Philosophy.**  
> Reconstructing dense philosophical prose into **Bipolar Argumentation Hypergraphs**, recovering unspoken premises (*enthymemes*) via NLI-constrained abduction, quantifying multi-model interpretive divergence, and executing a high-performance **Rust symbolic solver** (`atlas-core`) for formal acceptability semantics and minimal premise knockouts.

---

## Why Argument Atlas?

Existing LLM-based argument mining tools treat philosophical texts as flat node-link graphs ($G = (V, E)$) and force a single canonical interpretation. When applied to primary philosophical works (Plato, Descartes, Spinoza, Hume, Kant, Mill, Dostoevsky), naive pipelines fail on three fronts:

1. **Conjunctive Premises & Enthymemes (The Unspoken Bridge):** Philosophical arguments are rarely deductively complete on the page; they rely on suppressed premises (*enthymemes*) linked conjunctively with explicit claims ($(P_{\text{explicit}} \wedge E_{\text{implicit}}) \implies C$). Modeling premises as independent edges fails to capture that rejecting a single essential assumption collapses the inference.
2. **Rebutting vs. Undercutting Defeaters (Pollock, 1987):** An objection may attack a claim directly (**rebuttal**) or sever the inferential warrant between premises and conclusion (**undercutter**).
3. **Hermeneutic Pluralism:** Complex texts admit competing legitimate reconstructions across philosophical schools and language models. Disagreement on implicit premises is an epistemic signal, not mere noise.

---

## Formal Mathematical Architecture

Argument Atlas models arguments as a **Weighted Bipolar Argumentation Hypergraph (BAH)**:

$$\mathcal{H} = (\mathcal{A}, \mathcal{E}_{\text{sup}}, \mathcal{E}_{\text{att}}, \mathcal{E}_{\text{und}}, \sigma_0)$$

- **Proposition Nodes ($\mathcal{A}$):** Typed as `Thesis`, `ExplicitPremise`, `Enthymeme`, `Objection`, or `CounterfactualAssumption`, with deterministic character-offset span verification (`[start_char..end_char]`) against the primary source text and intrinsic base credence $\sigma_0(a) \in [0, 1]$.
- **Conjunctive Support Hyperedges ($\mathcal{E}_{\text{sup}}$):** Directed hyperedges $e = (S, c, w_e)$ where a non-empty premise set $S \subseteq \mathcal{A}$ jointly supports conclusion $c \in \mathcal{A}$ under a configurable T-norm (Gödel minimum $\min_{p \in S} \sigma(p)$ or Product $\prod_{p \in S} \sigma(p)$).
- **Rebutting Attacks ($\mathcal{E}_{\text{att}} \subseteq \mathcal{A} \times \mathcal{A}$):** Direct proposition-to-proposition conflict.
- **Undercutting Attacks ($\mathcal{E}_{\text{und}} \subseteq \mathcal{A} \times \mathcal{E}_{\text{sup}}$):** Pollock-style defeaters targeting a `SupportHyperedge` $e \in \mathcal{E}_{\text{sup}}$ directly.

---

## Core Capabilities Implemented in `crates/atlas-core`

| Module | Capability | Description |
| :--- | :--- | :--- |
| `src/model.rs` | **Bipolar Hypergraph & Span Verifier** | Strongly typed BAH representation with deterministic substring quote verification (`ArgumentHypergraph::validate`) to prevent LLM quote hallucination. |
| `src/gradual.rs` | **Hypergraph `DF-QuAD` Continuous Solver** | Generalizes *Discontinuity-Free Quantitative Argumentation Debate* semantics (Rago et al., KR 2016) to conjunctive hypergraphs and undercutters, using Successive Over-Relaxation (damped fixed-point iteration) to converge smoothly on cyclic dialectical graphs (e.g., Kant's *Antinomies*). |
| `src/dung.rs` | **Discrete Dung Extensions (`Grounded`, `Preferred`, `Stable`)** | Compiles a Bipolar Hypergraph into a classical Dung Abstract Argumentation Framework via the *Inference-Gate Auxiliary Node Reduction* (`compile_hypergraph_to_dung`) and computes exact `Grounded`, `Preferred`, and `Stable` extensions with 3-valued (`In`, `Out`, `Undecided`) Caminada labelings. |
| `src/knockout.rs` | **Minimal Premise Knockout Engine ("Achilles' Heel")** | Exact combinatorial search with minimal hitting-set pruning (`find_minimal_knockouts`) that discovers inclusion-minimal subsets of explicit premises and unspoken enthymemes whose removal collapses a target thesis below $\theta$, ranked by epistemic credence cost ($\sum_{k \in K} \sigma_0(k)$). |

---

## Quick Start

### Prerequisites
- Rust toolchain (`1.75+`, tested on `rustc 1.96.0`)

### Build & Run the Formal Verification Suite
```bash
git clone https://github.com/Bunlong-Prak/argument-atlas.git
cd argument-atlas

# Run all unit tests across gradual semantics, Dung extensions, and knockout search
cargo test

# Inspect a primary philosophical passage (Descartes, Hume, or Dostoevsky) with strict character-span verification
cargo run -p atlas-cli -- inspect datasets/phil-args/03_dostoevsky_ivan_rebellion.argdown --strict-spans

# Convert between human-readable .argdown and Bipolar Hypergraph JSON
cargo run -p atlas-cli -- convert datasets/phil-args/01_descartes_cogito.argdown --to json
```

---

## Repository Structure

```text
argument-atlas/
├── Cargo.toml                  # Rust workspace manifest
├── crates/
│   └── atlas-core/             # Core BAH model & symbolic solvers (Rust)
│       ├── src/model.rs        # Hypergraph schema & deterministic span verifier
│       ├── src/gradual.rs      # Hypergraph DF-QuAD continuous propagation solver
│       ├── src/dung.rs         # ASPIC+/Dung reduction & Grounded/Preferred/Stable solver
│       ├── src/knockout.rs     # Minimal premise knockout (hitting-set) search engine
│       └── src/lib.rs          # Philosophical unit test suite (Descartes, Pollock, Kant)
└── docs/
    └── RESEARCH_LOG.md         # Living record of mathematical decisions & findings
```

---

## Research Roadmap

- [x] **Milestone 1 (Core Engine):** Bipolar Argumentation Hypergraph model, Hypergraph `DF-QuAD` gradual semantics solver, discrete Dung extension compiler (`Grounded`/`Preferred`/`Stable`), and Minimal Premise Knockout engine in Rust (`atlas-core` + `atlas-cli`).
- [ ] **Milestone 2 (Benchmark & Interoperability):** Bidirectional `.argdown` $\leftrightarrow$ `ArgumentHypergraph` parser/exporter *(done)* and expanding the starter 3-passage corpus (`datasets/phil-args`) to `PhilArgs-50`.
- [ ] **Milestone 3 (Neuro-Symbolic Extraction & Enthymeme Abduction):** Deterministic character-span grounder, Rust IPC bridge, and `DeBERTa-v3` + `BGE` Abductive-NLI enthymeme scorer *(Unit 3.1 done)*; multi-provider LLM extractor pipeline *(next)*.
- [ ] **Milestone 4 (Hermeneutic Prism):** Multi-model bipartite semantic graph alignment (Hungarian algorithm over `BGE` proposition embeddings) to quantify interpretive consensus vs. divergence.
- [ ] **Milestone 5 (Interactive Scientific Workbench):** Next.js + React Flow + `elkjs` layered hypergraph canvas powered by `atlas-core` compiled to WebAssembly for 60fps counterfactual credence manipulation.

---

## Author & License

Created and maintained by **Bunlong Prak (Nate)** ([@Bunlong-Prak](https://github.com/Bunlong-Prak)).  
Released under the [MIT License](LICENSE).
