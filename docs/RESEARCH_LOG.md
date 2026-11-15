# Argument Atlas — Living Research & Engineering Log

This document records all architectural decisions, mathematical formulations, empirical findings, bug analyses, and open research questions across the development of **Argument Atlas**.

---

## Milestone 1: Formal Hypergraph Model & Symbolic Dialectical Engine (`atlas-core`)

### Unit 1.1: Bipolar Argumentation Hypergraph (BAH) & Hypergraph `DF-QuAD` Gradual Semantics
- **Date:** 2026-11-14
- **Status:** Implemented & Verified (`cargo test` passing)

#### 1. Technical Decisions Recorded
1. **Why Directed Hypergraphs Instead of Standard Graphs ($G = (V, E)$):**
   - In philosophical reasoning (e.g., Descartes' *Cogito* or Kant's *Antinomies*), an explicit premise $P_1$ ("I think") rarely entails conclusion $C$ ("I exist") in isolation. It requires an implicit premise (enthymeme) $E_1$ ("Whatever thinks must exist").
   - If $P_1 \to C$ and $E_1 \to C$ are modeled as two independent edges in a standard graph, setting $\sigma_0(E_1) = 0$ leaves $P_1 \to C$ intact—which is logically false for linked (conjunctive) arguments.
   - Modeling support via `SupportHyperedge` $e = (S, c, w_e)$ with T-norm conjunction ($\min_{p \in S} \sigma(p)$ or $\prod_{p \in S} \sigma(p)$) guarantees that rejecting an essential unspoken premise collapses the entire conjunctive inference warrant.
2. **First-Class Pollock Undercutters (`UndercuttingAttack`):**
   - Following John Pollock (*Defeasible Reasoning*, 1987), we distinguish **rebutting defeaters** (which attack a proposition node $b \in \mathcal{A}$ directly and drive $\sigma^*(b)$ below its prior $\sigma_0(b)$) from **undercutting defeaters** (which attack a support hyperedge $e \in \mathcal{E}_{\text{sup}}$, driving $\tau(e) \to 0$ so the conclusion returns to its prior $\sigma_0(c)$ rather than being falsified).
3. **Deterministic Span Verification at the Type Boundary (`ArgumentHypergraph::validate`):**
   - To eliminate LLM quote hallucination in downstream benchmarks, `validate(true)` converts `source_text` into a `Vec<char>` and verifies that every non-`Enthymeme` node's `TextSpan` (`[start_char..end_char]`) matches `verbatim_quote` character-for-character.
4. **Damped Fixed-Point Relaxation for Dialectical Cycles:**
   - Philosophical texts frequently contain symmetric mutual-attack cycles (e.g., Kant's *Antinomies of Pure Reason* or Socratic aporia where Thesis $A \leftrightarrow$ Antithesis $B$).
   - Un-damped iterative substitution ($\alpha = 1.0$) on a symmetric cycle $A \leftrightarrow B$ oscillates indefinitely between upper and lower states without converging.
   - Applying Successive Over-Relaxation / damped fixed-point updates $\sigma^{(t+1)} = (1 - \alpha)\sigma^{(t)} + \alpha F(\sigma^{(t)})$ with $\alpha = 0.6$ guarantees rapid contraction to the analytical fixed point $\sigma^* = \frac{v_0}{1 + v_0}$ (verified analytically for $v_0 = 0.8 \implies \sigma^* = \frac{4}{9} \approx 0.4444444$).

#### 2. Failures Identified & Fixed During Unit 1.1
- **IEEE-754 1-ULP Floating-Point Comparison in Fixed-Point Verification:**
  - *Symptom:* `assert_eq!(df_quad_combine(0.8, expected, 0.0), expected)` failed with `left: 0.4444444444444444` vs `right: 0.4444444444444445` (1 unit in the last place).
  - *Root Cause:* `0.8 - 0.8 * (0.8 / 1.8)` incurs a 1-ULP rounding difference in 64-bit IEEE-754 arithmetic compared to direct division `0.8 / 1.8`.
  - *Fix:* Replaced exact `==` float assertion with bounded $\epsilon = 10^{-15}$ residual check and added explicit comparison tests between Gödel (`GodelMinimum`) and Product (`Product`) T-norms.

#### 3. Open Questions for Unit 1.2 (Discrete Dung Extensions & Minimal Premise Knockouts)
- How should we map a Bipolar Hypergraph $(\mathcal{A}, \mathcal{E}_{\text{sup}}, \mathcal{E}_{\text{att}}, \mathcal{E}_{\text{und}})$ into a discrete **Dung Abstract Argumentation Framework** $(A', R')$ so we can compute exact `Grounded`, `Preferred`, and `Stable` extensions alongside continuous `DF-QuAD` scores?
  - *Proposed reduction for Unit 1.2:* Construct a meta-graph where each proposition $a \in \mathcal{A}$ and each support hyperedge $e \in \mathcal{E}_{\text{sup}}$ is represented, and solve for minimal premise knockouts $K \subseteq \mathcal{A}$ of minimum cardinality $|K|$ (or minimum total credence cost $\sum_{k \in K} \sigma_0(k)$) that reduce $\sigma^*(\text{Thesis})$ below a target threshold $\theta$.


---

### Unit 1.2: Discrete Dung Extension Solver & Minimal Premise Knockout Engine
- **Date:** 2026-11-14
- **Status:** Implemented & Verified (`cargo test` passing: 7/7 tests)

#### 1. Technical Decisions Recorded
1. **Inference-Gate Auxiliary Node Reduction (`compile_hypergraph_to_dung`):**
   - To evaluate Bipolar Argumentation Hypergraphs under classical discrete Dung semantics (`Grounded`, `Preferred`, `Stable`) without losing either conjunctive hyperedges or Pollock undercutters, each active proposition $a$ becomes `node:{id}`, each active support hyperedge $e = (S, c)$ becomes `edge:{id}`, and derived claims (`base_credence < 0.5 || NodeType::Thesis`) with incoming support receive a **Support-Deficiency Guard** `unwarranted:{id}` attacking `node:{id}` (which is in turn attacked by every incoming `edge:{e}`).
   - Crucially, in a second pass over `attack_set`, every attacker $x$ of any premise `node:{p}` ($p \in S$)—including `unwarranted:{p}`—is propagated to attack `edge:{e}`. This guarantees transitive collapse across multi-hop support chains ($P_1 \xrightarrow{H_1} M_1 \xrightarrow{H_2} C$) whenever an upstream premise or inference gate is defeated, while still permitting reinstatement when a defender defeats an undercutter.
2. **Constraint-Propagated Labeling Search for Preferred & Stable Extensions (`dung.rs`):**
   - Instead of naive $2^{|A|}$ subset enumeration over compiled auxiliary arguments, `compute_preferred_extensions` runs a 5-state (`Blank`, `In`, `Out`, `MustOut`, `Blocked`) backtracking solver with grounded forced-inclusion propagation and immediate `MustOut` infeasibility pruning, then filters $\subseteq$-maximal admissible sets and checks the range criterion for stable extensions.
3. **Inclusion-Minimal Premise Knockout Search (`knockout.rs`):**
   - `find_minimal_knockouts` performs increasing-cardinality ($k = 1 \dots \text{max\_subset\_size}$) lexicographic combination search over eligible `ExplicitPremise`/`Enthymeme` nodes with **minimal hitting-set pruning** (skipping any combination that is a superset of an already discovered knockout).
   - Results are ranked primarily by **epistemic credence cost** ($\sum_{k \in K} \sigma_0(k)$) rather than raw cardinality alone, surfacing fragile unspoken assumptions (low-credence enthymemes) first.

#### 2. Verification Scope
- `cargo test` in `/Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas`: all 7 unit tests pass with zero warnings (`test_dung_nixon_diamond_and_reinstatement`, `test_hypergraph_dung_reinstatement_against_undercutter`, `test_minimal_knockout_prefers_weak_enthymeme_and_handles_convergent_branches`, plus all 4 Unit 1.1 tests).

#### 3. Next Questions for Unit 1.3 / Milestone 2
- Should we expose `atlas-core` via a CLI / `PyO3` / `wasm-bindgen` bridge next (Unit 1.3), or move into Milestone 2's bidirectional `.argdown` parser/exporter and curated `PhilArgs-15` starter corpus?


---

## Milestone 2, Unit 2.1: Bidirectional `.argdown` Bridge, `atlas-cli`, and the Multi-Hop Prior Inflation Discovery
- **Date:** 2026-11-15
- **Status:** Implemented, Verified (`8/8` unit tests + `3/3` strict-span CLI benchmark inspections), and Pushed

### 1. Components Implemented
1. **Lossless `.argdown` $\leftrightarrow$ `ArgumentHypergraph` Bridge (`crates/atlas-core/src/argdown.rs`):**
   - `to_argdown` and `parse_argdown` support YAML frontmatter (`passage_id`, `source_text`), typed propositions with character-offset spans (`span: start..end, quote: "..."`), conjunctive support hyperedges (`<H1>: [P1] & [E1] +> [C]`), rebutting attacks (`->`), and Pollock undercutting attacks (`_>`).
2. **Command-Line Research Instrument (`crates/atlas-cli/src/main.rs`):**
   - `atlas-cli inspect <file> [--strict-spans] [--json]`: Validates character spans, runs `DF-QuAD` gradual semantics and `Dung` extension compilation in `<0.6ms`, and outputs ranked Minimal Premise Knockouts.
   - `atlas-cli convert <file> --to <argdown|json>`: Lossless format conversion.
3. **Initial Public-Domain Philosophical Benchmark (`datasets/phil-args/`):**
   - `01_descartes_cogito.argdown` (Descartes, *Discourse on the Method* Part IV, Veitch translation)
   - `02_hume_problem_of_induction.argdown` (Hume, *Enquiry Concerning Human Understanding* Sec. IV, 1748)
   - `03_dostoevsky_ivan_rebellion.argdown` (Dostoevsky, *The Brothers Karamazov* Book V Ch. 4 "Rebellion", Garnett 1912 translation)

### 2. Major Mathematical Finding: "Prior Inflation in Multi-Hop `DF-QuAD` Chains"
- **Observation during Step 6/7 Inspection:**
  When testing `03_dostoevsky_ivan_rebellion.argdown` ($P_1 \wedge E_1 \xrightarrow{H_1} P_2 \xrightarrow{H_2} P_3 \wedge E_2 \xrightarrow{H_3} C$), we initially assigned non-zero intrinsic priors $\sigma_0(P_2) = 0.15, \sigma_0(P_3) = 0.15, \sigma_0(C) = 0.35$ to the *intermediate derived claims* (`P2`, `P3`) and thesis (`C`).
  When `E1` was knocked out ($\sigma_0(E_1) = 0$), $\tau(H_1)$ collapsed to $0$, yet `C` remained at $0.5150 > 0.50$!
- **Mathematical Root Cause:**
  Under classical `DF-QuAD` aggregation $\sigma^*(c) = \sigma_0(c) + (1 - \sigma_0(c)) v_{\text{sup}}(c)$, if intermediate derived claims in an $L$-hop chain $P_0 \xrightarrow{w} P_1 \xrightarrow{w} \dots \xrightarrow{w} P_L$ carry a positive prior $\sigma_0 > 0$, then even when the root premise $P_0$ is falsified ($\sigma^*(P_0) = 0$), the recurrence $\sigma^*(P_k) = \sigma_0 + (1 - \sigma_0) w \sigma^*(P_{k-1})$ converges toward the positive fixed point:
  $$\sigma_{\infty} = \frac{\sigma_0}{1 - (1 - \sigma_0)w} > 0$$
  Thus, non-zero priors on intermediate derived nodes cause **spurious self-inflation across multi-hop chains**.
- **Principle of Grounded Evidential Priors (Our Fix):**
  In deductive/evidential argument reconstruction, **foundational roots** (premises, objections, and enthymemes with no incoming support hyperedges) carry positive epistemic priors $\sigma_0 \in (0, 1]$, whereas **derived claims** (nodes whose justification within the passage derives from incoming `SupportHyperedge`s) must be initialized with $\sigma_0 = 0.0$ unless backed by independent external evidence.
  With $\sigma_0(P_2) = \sigma_0(P_3) = \sigma_0(C) = 0.0$, `atlas-cli inspect` on Dostoevsky's *Rebellion* cleanly surfaces the exact two single-enthymeme knockouts (`[E2]` at cost `0.75` and `[E1]` at cost `0.88`) that collapse Ivan's thesis from `0.7125` to `0.0000`.
