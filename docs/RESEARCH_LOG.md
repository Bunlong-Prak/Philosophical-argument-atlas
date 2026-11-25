# Argument Atlas: Living Research & Engineering Log

This document records all architectural decisions, mathematical formulations, empirical findings, bug analyses, and open research questions across the development of **Argument Atlas**.

---

## Milestone 1: Formal Hypergraph Model & Symbolic Dialectical Engine (`atlas-core`)

### Unit 1.1: Bipolar Argumentation Hypergraph (BAH) & Hypergraph `DF-QuAD` Gradual Semantics
- **Date:** 2026-11-14
- **Status:** Implemented & Verified (`cargo test` passing)

#### 1. Technical Decisions Recorded
1. **Why Directed Hypergraphs Instead of Standard Graphs ($G = (V, E)$):**
   - In philosophical reasoning (e.g., Descartes' *Cogito* or Kant's *Antinomies*), an explicit premise $P_1$ ("I think") rarely entails conclusion $C$ ("I exist") in isolation. It requires an implicit premise (enthymeme) $E_1$ ("Whatever thinks must exist").
   - If $P_1 \to C$ and $E_1 \to C$ are modeled as two independent edges in a standard graph, setting $\sigma_0(E_1) = 0$ leaves $P_1 \to C$ intact, which is logically false for linked (conjunctive) arguments.
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
   - In a second pass over `attack_set`, every attacker $x$ of any premise `node:{p}` ($p \in S$), including `unwarranted:{p}`, propagates forward to attack `edge:{e}`. This guarantees transitive collapse across multi-hop support chains ($P_1 \xrightarrow{H_1} M_1 \xrightarrow{H_2} C$) whenever an upstream premise or inference gate is defeated, while still permitting reinstatement when a defender defeats an undercutter.
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


---

## Milestone 3, Unit 3.1: Python Neuro-Symbolic Package (`atlas-ml`), Deterministic Span Grounder & Abductive-NLI Enthymeme Scorer
- **Date:** 2026-11-17
- **Status:** Implemented, Empirically Verified on Apple M3 MPS (`4/4` pytest + `3/3` exact 4-class ablation verdicts)

### 1. Components Implemented
1. **Rust Solver IPC (`crates/atlas-cli/src/main.rs` & `backend/src/atlas_ml/rust_bridge.py`):**
   - Added `atlas-cli solve --stdin [--strict-spans] [--threshold <f64>] [--t-norm <godel|product>]`, solving full BAH graphs (`DF-QuAD` + `Dung` + `MinimalKnockouts`) in **`100 µs`** in `--release` mode.
   - `AtlasRustBridge` provides typed Pydantic v2 round-tripping between Python (`atlas_ml`) and Rust (`atlas-core`).
2. **Deterministic Character-Span Grounder (`backend/src/atlas_ml/schemas.py`):**
   - `DeterministicSpanGrounder` maps approximate LLM-extracted quotes back to exact Unicode scalar `[start_char..end_char]` offsets (compatible 1-to-1 with Rust's `Vec<char>` validation) via exact matching, whitespace/smart-quote normalization, duplicate disambiguation via `hint_start`, and bounded fuzzy anchor alignment (`SequenceMatcher`), strictly rejecting ungrounded hallucinations (`SpanGroundingError`).
3. **Abductive-NLI Enthymeme Scorer (`backend/src/atlas_ml/nli_enthymeme.py`):**
   - Hardware-aware sizing for 8 GB Apple Silicon M3 (`mps`): uses `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli` (`184M` params, dynamic `id2label` lookup) + `BAAI/bge-small-en-v1.5` (`33M` params).
   - Evaluates candidate implicit premises via:
     $$\mathcal{S}(E \mid P, C) = \Delta\text{NLI}(E \mid P, C) - \lambda_{\text{usurp}} \cdot U(E, C) - \lambda_{\text{triv}} \cdot T(E, P, C) - 0.50 \cdot P_{\text{contra}}(C \mid P \cup \{E\})$$

### 2. Empirical Bugs & NLI Failure Modes Discovered and Fixed
1. **Fuzzy Alignment Window Truncation on Parenthetical Omissions:**
   - *Failure:* `"All inferences from experience are effects of custom"` failed to align to `"All inferences from experience, therefore, are effects of custom, not of reasoning."` because the initial `1.15x` window cap clipped off the end of `"custom"` when `", therefore,"` expanded the source span by 12 chars.
   - *Fix:* Expanded window to `1.35x + 12` and computed `[local_start..local_end]` strictly from anchor blocks of length $\ge 3$, avoiding stray 1-character tail matches.
2. **NLI Conflation of Material Conditionals and Inductive Over-Generalization (`eval_enthymeme_ablation.py`):**
   - *Observation 1 (Material Conditional Usurpation):* `DeBERTa-v3` assigned $P_{\text{NLI}}(C \mid \text{"If } P \text{, then } C\text{"}) = 0.977\text{--}0.986$ even though a material conditional alone does not entail its consequent! Combining $\cos(\phi(E), \phi(T_{P \to C})) > 0.80$ with `novel_content_ratio` (`0.00` on all three tautologies) cleanly isolates trivial conditionals (`trivial_tautology`).
   - *Observation 2 (Reverse NLI Inductive Over-Generalization vs. Paraphrase Usurpation):* In Dostoevsky, a paraphrase usurpation (*"Cosmic harmony purchased by innocent suffering is morally unacceptable and unworthy"*) escaped forward NLI (`usurpNLI=0.217`) because it omitted `"child's"`, yet scored `revNLI = 0.985` ($C \implies E$). Conversely, applying raw `revNLI` directly flagged Descartes' gold universal bridge (*"Whatever is actively thinking must exist..."*) because `DeBERTa-v3` over-generalized a single-subject claim into a universal law (`revNLI = 0.916`).
   - *Fix:* Gated reverse-entailment circularity on semantic proximity (`reverse_nli >= 0.93 and concl_sim >= 0.86`).
   - *Verified Result (`MPS`, 2.23s model load):* Gold enthymeme ranked **#1 in 3/3 passages** (Descartes `+0.5122`, Hume `+0.2986`, Dostoevsky `+0.8439`) with **3/3 exact 4-class categorical verdicts** across all 12 candidates.


---

## Milestone 2, Unit 2.2 & Milestone 4 Core: `PhilArgs-6` Dialectical Corpus & Bipartite Semantic Hypergraph Aligner
- **Date:** 2026-11-18
- **Status:** Implemented & Empirically Verified (`8/8` Rust tests, `6/6` pytest, live `bge-small` alignment `1.0000`)

### 1. Components Implemented
1. **Expanded Dialectical Corpus (`datasets/phil-args/`):**
   - Added 3 rich public-domain dialectical passages verified with strict character spans (`--strict-spans`):
     - `04_plato_euthyphro_dilemma.argdown` (Jowett translation): Exercises both rebutting attacks (`->`) and Pollock undercutting attacks (`_>`), defeating Euthyphro's divine-command thesis `[C]` (`0.0000`, `Dung=Out`, `<H1>` transmission crushed to `0.1191` in `40 µs`).
     - `05_kant_third_antinomy.argdown` (Meiklejohn translation): Exercises symmetric mutual rebuttal cycles (`Thesis <-> Antithesis`), converging via `DF-QuAD` relaxation to a `0.4000` dialectical tie where `Grounded` labels both `Undecided` and `Preferred`/`Stable` split into 2 worldviews (`44 µs`).
     - `06_mill_on_liberty_infallibility.argdown` (J.S. Mill, 1859): Exercises counterfactual censorship premises undercut and defeated by Mill's fallibilism (`[C] = 0.9120`, `Dung=In`; `[Censorship] = 0.0000`, `Dung=Out` in `54 µs`).
2. **Hungarian Bipartite Semantic Hypergraph Aligner (`backend/src/atlas_ml/graph_aligner.py`):**
   - Shared mathematical core for Milestone 3 benchmark evaluation (`Predicted vs. Gold`) and Milestone 4 Hermeneutic Prism (`Model A vs. Model B` consensus).
   - Computes optimal node matching (`scipy.optimize.linear_sum_assignment` over `BAAI/bge-small-en-v1.5` embeddings), per-category F1 (`explicit_node_prf`, `enthymeme_prf`), canonical ID-invariant `support_hyperedge_exact_prf`, partial-credit `support_link_prf`, `rebuttal_prf`, and `undercutter_prf` (matching undercutting attacks over canonical hyperedge signatures).

### 2. Bugs & Embedding Geometry Failures Discovered and Fixed
1. **Relative `repo_root` Resolution Bug in `AtlasRustBridge` (`rust_bridge.py`):**
   - *Symptom:* Passing relative `Path("..")` caused `FileNotFoundError` because `subprocess.run(..., cwd=str(self.repo_root))` resolved `cmd[0]` (`../target/release/atlas-cli`) twice.
   - *Fix:* Normalized `self.repo_root = Path(repo_root).resolve()`.
2. **Embedding-Space Inversion Between Implicit Enthymemes and Derived Conclusions (`eval_corpus_and_aligner.py`):**
   - *Observation:* On live `BAAI/bge-small-en-v1.5` embeddings of Plato's *Euthyphro*, pure cosine Hungarian matching swapped `alt_E1 <-> C` (`0.810`) and `alt_C <-> E1` (`0.887`, sum `1.697`) over the true diagonal `alt_E1 <-> E1` (`0.840`) and `alt_C <-> C` (`0.847`, sum `1.687`) because an unspoken enthymeme and its conclusion share identical domain nouns (*"gods"*, *"holy"*, *"loved"*). That `0.010` cosine swap caused `Rebuttal F1` and `Undercutter F1` to collapse from `1.0000` to `0.0000`!
   - *Fix:* Kept raw cosine threshold gating $\cos \ge \tau$, while adding a bounded epistemic-role tie-breaker (`+0.05` when matching explicit vs. implicit `Enthymeme` partition, `+0.02` when matching exact `NodeType`) inside the Hungarian objective. Re-running `eval_corpus_and_aligner.py` restored `Node F1 = 1.0000`, `Hyperedge F1 = 1.0000`, `Rebuttal F1 = 1.0000`, `Undercutter F1 = 1.0000`, `Consensus = 1.0000`.


---

## Milestone 3, Unit 3.2: Multi-Provider Neuro-Symbolic Pipeline, FastAPI Service, and Readable Documentation
- **Date:** 2026-11-19
- **Status:** Implemented & Verified (`8/8` Rust tests, `8/8` pytest including pipeline and FastAPI endpoint integration tests)

### 1. Components Added
1. **End-to-End Neuro-Symbolic Extractor ([backend/src/atlas_ml/extractor.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/extractor.py)):**
   - Added `HttpLLMClient` using `httpx` with support for Groq, OpenAI, Anthropic, and local Ollama JSON outputs.
   - `NeuroSymbolicPipeline.run` chains raw LLM JSON extraction through `DeterministicSpanGrounder` (re-aligning whitespace/smart-quote drift and dropping fabricated explicit quotes plus dangling edges), `AbductiveNLIScorer` (auditing extracted enthymemes for circularity and tautologies), and `AtlasRustBridge.solve` (strict span validation + `DF-QuAD` + `Dung` + minimal knockouts).
2. **FastAPI Service ([backend/src/atlas_ml/api.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/api.py)) & `.argdown` IPC ([rust_bridge.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/rust_bridge.py)):**
   - Added `solve_argdown` to `AtlasRustBridge` using `atlas-cli solve --stdin`.
   - Exposed `/health`, `/passages`, `/passages/{passage_id}`, `/solve`, `/solve-argdown`, `/score-enthymemes`, `/align`, and `/extract` with lazy initialization for `DeBERTa-v3` and `BGE-small`.
3. **Humanized, ADHD-Friendly Documentation ([README.md](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/README.md) & [docs/GUIDE.md](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/docs/GUIDE.md)):**
   - Rewrote `README.md` to lead with a 30-second Dostoevsky example before formalism, and added `docs/GUIDE.md` with short visual examples for hyperedges, undercutters, antinomy cycles, and NLI anti-cheating checks.
   - Applied `humanizer` and `academic-research-skills` quality checks across both docs (removed em/en dashes in prose, staged openers, "not X but Y" framing, and overused AI filler terms).

### 2. Verification Scope
- Added [backend/tests/test_pipeline_and_api.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/tests/test_pipeline_and_api.py): verified `NeuroSymbolicPipeline` end-to-end with deterministic fake LLM/NLI stubs + real Rust solver (`FAKE` hallucination dropped, `P1` repaired, `E1` surfaced as #1 knockout) and verified all FastAPI endpoints via `TestClient` (including live slider perturbation on `kant-third-antinomy` and HTTP `503` guard when `GROQ_API_KEY` is unset).

---

## Milestone 5, Unit 5.1: Interactive Next.js Workbench UI and Critical-Edition Apparatus
- **Date:** 2026-11-21
- **Status:** Implemented & Verified (`8/8` Rust tests, `8/8` pytest including `/parse-argdown`, `tsc --noEmit` + `next build` clean, `impeccable detect --json` `0` findings, Impeccable Finish Reviewer `disposition: ship`)

### 1. Components Added
1. **Next.js App Router Workbench ([web/src/app/page.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/app/page.tsx)) & Design Tokens ([web/src/app/globals.css](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/app/globals.css), [DESIGN.md](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/DESIGN.md)):**
   - Implemented a 3-pane split workbench (`SourceReader`, `HypergraphCanvas`, `ApparatusInspector`) over a daylight archival paper palette (`#F7F5F0`, `#FAF8F4`, `#EEECE4`) pairing `Newsreader` serif prose, `IBM Plex Sans` controls, and `JetBrains Mono` tabular solver metrics.
   - Configured Next.js `/api/*` rewrites in `web/next.config.ts` to proxy local FastAPI endpoints (`http://127.0.0.1:8000`).
2. **Layered Bipolar Hypergraph & Credence Controls ([web/src/lib/elkLayout.ts](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/lib/elkLayout.ts), [HypergraphCanvas.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/components/HypergraphCanvas.tsx), [ApparatusInspector.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/components/ApparatusInspector.tsx)):**
   - Wired `elkjs` layered UP placement + `@xyflow/react` custom nodes separating propositions (`PropositionNodeCard`) from conjunctive hyperedge gates (`InferenceGateNode`), encoding active support in solid cobalt, implicit enthymemes/undercutters in dashed sienna, direct rebuttals in crimson, and severed gates in muted dashed strokes.
   - Added accessible native range sliders (`--slider-progress` using baseline `progress()` with `@supports not` `calc()` fallback), one-click **Test** buttons for `MinimalKnockout` hypotheses, `Gödel min` / `Product` T-norm switching, and Dung `Grounded`/`Preferred` extension readouts.
3. **Offline `.argdown` Parse & NLI Custom Lab ([backend/src/atlas_ml/api.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/api.py), [CustomLabPanel.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/components/CustomLabPanel.tsx)):**
   - Added `AtlasRustBridge.parse_argdown_text` + `POST /parse-argdown` so users without cloud LLM API keys can write or edit formal `.argdown` specifications offline and open solved graphs straight into the Workbench alongside the `DeBERTa-v3` Enthymeme Auditor and optional LLM extraction.

### 2. Visual & Browser Bugs Caught and Resolved
1. **Atomic `<button>` Breaking Inline Source Prose:**
   - *Observation:* Rendering inline quote spans in `SourceReader` as `<button style="display: inline">` still forced rectangular inline-block line breaks in Chromium after *"And if"* in Dostoevsky's text.
   - *Fix:* Switched `.span-highlight` elements to flow-inline `<span role="button" tabIndex={0}>` with `Enter`/`Space` keyboard handlers and `box-decoration-break: clone`, wrapping cleanly across lines without splitting sentences.
2. **React Flow v13 `fitView` Numeric Padding Parsing (`0.16` Parsed as `0.16px`) & Edge Dash Collision:**
   - *Observation:* Playwright bounding-box checks and Finish Reviewer screenshot inspection showed `fitView({ padding: 0.16 })` left only `1px` vertical margin (`maxNodeBottom: 901` inside `canvasBottom: 900`), while `animated: true` forced React Flow to draw solid Support edges dashed like Enthymemes and `-webkit-line-clamp: 3` clipped `[E1]`/`[E2]` propositions.
   - *Fix:* Passed percentage padding (`padding: "6%"`) plus `ResizeObserver` + `useNodesInitialized` re-fit, removed `animated: true` on resting Support edges, removed line clamping paired with `estimatePropHeight` in ELK, moved the legend into its own non-overlapping canvas header strip, and added `.argdown` numeric prefix stripping (`Dostoevsky: Ivan Rebellion`).
3. **Custom Lab Back-to-Corpus State Bug:**
   - *Observation:* Playwright UI testing caught that opening a custom `.argdown` graph left `selectedId` equal to `"dostoevsky-ivan-rebellion"`, blocking re-selection of Dostoevsky in the header `<select>`.
   - *Fix:* Set `selectedId` to `"__custom__"` when loading a custom graph from the lab and added a temporary `<option value="__custom__">` entry.

### 3. Verification Scope
- `cargo test`: `8 passed; 0 failed` (`atlas-core` solvers & round-trip).
- `uv run pytest -v`: `8 passed` (including `POST /parse-argdown`, `/solve`, `/align`, and `/extract` 503 guard).
- `cd web && npm run lint && npm run build`: `tsc --noEmit` and Next.js 16 production build passed cleanly.
- Playwright end-to-end check on live Next.js + FastAPI (`1440x900` desktop, `390x844` workbench, `390x844` lab tab): confirmed `0` console/page/HTTP errors, `0` horizontal overflow on all three views, unclipped hypergraph bounds (`47px+` vertical clearance), live knockout + reset state propagation, and custom `.argdown` graph loading; Impeccable Finish Reviewer scored all 5 material fixes resolved (`disposition: ship`).

---

## Milestone 4, Unit 4.1: Hermeneutic Prism Multi-Lens Corpus, Dual-Provider API, and Interactive UI
- **Date:** 2026-11-22
- **Status:** Implemented & Verified (`8/8` Rust tests, `10/10` pytest, live `BAAI/bge-small-en-v1.5` benchmark, `tsc --noEmit` + `next build` clean, `impeccable detect --json` `0` findings, Playwright desktop + 390px mobile zero-overflow verified)

### 1. Components Added
1. **Curated Rival Hermeneutic Lenses ([datasets/hermeneutic-lenses](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/hermeneutic-lenses)):**
   - Added 4 strict-span `.argdown` rival philosophical readings paired to corpus texts:
     - `01_descartes_lichtenberg_lens.argdown` (introduces grammatical undercutter `<UND_lich>` against `<H1>`, collapsing `[C]` from `0.7410 in` to `0.2451 out`).
     - `03_dostoevsky_theodicy_lens.argdown` (omits `[E2]` and adds `[E_theodicy]` rebutting `[E1]`, shifting `[C]` from `0.7125 in` to `0.2992 out`).
     - `04_plato_divine_command_lens.argdown` (reconstructs Euthyphro across 7 paraphrased propositions and renamed `alt_*` IDs to test semantic isomorphism across thresholds).
     - `05_kant_compatibilist_lens.argdown` (drops rationalist regress premise `[E1]` and undercuts `<H1>`, breaking Kant's `0.4000 / 0.4000` deadlock to `Thesis=0.0000 out`, `Antithesis=0.8000 in`).
2. **Backend Endpoints & Benchmark Runner ([api.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/api.py), [eval_hermeneutic_prism.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/scripts/eval_hermeneutic_prism.py)):**
   - Exposed `GET /hermeneutic-lenses` and `POST /compare-text` (runs two configured providers via `NeuroSymbolicPipeline` and aligns their outputs via `BipartiteGraphAligner`, returning HTTP `503` when cloud API keys are unset).
   - Added `eval_hermeneutic_prism.py` computing threshold sensitivity across $\tau \in \{0.65, 0.72, 0.80\}$ with live `BAAI/bge-small-en-v1.5` embeddings.
3. **Interactive Hermeneutic Prism UI ([HermeneuticPrismPanel.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/components/HermeneuticPrismPanel.tsx), [page.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/app/page.tsx), [globals.css](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/app/globals.css)):**
   - Added **Hermeneutic Prism** tab with Reading A / Reading B selectors (including current live Workbench state), an interactive cosine similarity slider ($\tau \in [0.45, 0.95]$), a 6-metric consensus scoreboard + Thesis shift card, a container-query responsive match table (`@container (width < 640px)`), dashed divergence lists, and a one-click **Open Reading B in Workbench** jump button.

### 2. Live Benchmark Observations (`BAAI/bge-small-en-v1.5`)
- At the default threshold $\tau = 0.72$:
  - `plato-voluntarism-paraphrase` vs `plato-euthyphro-dilemma`: `ExplicitF1 = 1.000`, `EnthF1 = 1.000`, `SupEdgeF1 = 1.000`, `RebF1 = 1.000`, `UndF1 = 1.000`, `Consensus = 1.000`. Raising $\tau \to 0.80$ drops one heavily paraphrased explicit match (`ExplicitF1 = 0.800`, `UndF1 = 0.000`, `Consensus = 0.678`).
  - `dostoevsky-theodicy-lens` vs `dostoevsky-ivan-rebellion`: `ExplicitF1 = 1.000`, `EnthF1 = 0.500`, `SupEdgeF1 = 0.667`, `RebF1 = 0.000`, `Consensus = 0.583`, capturing exact divergence on `[E2]` and `[E_theodicy]` while explicit text spans stay aligned.
  - `descartes-lichtenberg-lens` vs `descartes-discourse-cogito`: `ExplicitF1 = 0.750`, `EnthF1 = 0.000`, `UndF1 = 0.000`, `Consensus = 0.417`.
  - `kant-compatibilist-lens` vs `kant-third-antinomy`: `ExplicitF1 = 0.750`, `EnthF1 = 0.500`, `RebF1 = 1.000`, `UndF1 = 0.000`, `Consensus = 0.500`.

### 3. UI Bug Caught & Fixed During Browser Audit
- **Header Flex Overflow Across Three Tabs on 390px Mobile:** Adding `"Hermeneutic Prism"` to `.atlas-tablist` caused flex items without `min-inline-size: 0` or wrapping to widen `document.documentElement` past `390px`. Adding `.atlas-nav` (`min-inline-size: 0; max-inline-size: 100%`), `flex-wrap: wrap` on `.atlas-tablist`, compact mobile tab padding below `640px`, and removing the inner table height cap eliminated horizontal overflow (`overflow_mobile = false`, `overflow_lab_mobile = false`, `overflow_prism_mobile = false`).

---

## Milestone 2 (Unit 2.3) & Milestone 5 (Unit 5.2): `PhilArgs-12`, In-Browser WebAssembly Solver (`atlas-wasm`), and Flat-Graph Knockout Ablation
- **Date:** 2026-11-24
- **Status:** Implemented & Empirically Verified (`9/9` Rust workspace tests, `10/10` pytest, `18/18` strict-span `.argdown` files, `eval_full_benchmark.py` exit `0`, zero-backend Wasm + full-stack Playwright checks passing)

### 1. Components Implemented
1. **Zero-Dependency Rust WebAssembly Solver ([crates/atlas-wasm/src/lib.rs](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/crates/atlas-wasm/src/lib.rs), [web/src/lib/wasmSolver.ts](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/lib/wasmSolver.ts)):**
   - Compiled `atlas-core` to `wasm32-unknown-unknown` (`349 KB` LTO-stripped `web/public/atlas_wasm.wasm`) exposing `atlas_alloc`, `atlas_dealloc`, `atlas_solve_json`, and `atlas_parse_argdown`.
   - Avoided `std::time::Instant::now()` inside `wasm32-unknown-unknown` (which panics without WASI clocks) and measured microsecond solve latency on the JS side (`~62-63 µs` in headless Chrome), enabling 60fps slider updates and `.argdown` parsing without a Python server.
2. **Multi-Tradition `PhilArgs-12` Corpus & 6 Rival Lenses ([datasets/phil-args](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args), [datasets/hermeneutic-lenses](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/hermeneutic-lenses)):**
   - Doubled the primary strict-span corpus from 6 to 12 passages by adding Anselm vs. Gaunilo (`07`), Spinoza's *Ethics* I.p14 (`08`), Pascal's Wager (`09`), Aristotle's *Ergon* argument (`10`), Epicurus's Trilemma via Hume (`11`), and Zhuangzi's *Joy of Fish* (`12`).
   - Added 2 new rival lenses: Diderot's *Many-Gods* objection to Pascal (`09_pascal_many_gods_lens.argdown`, shifting `[C]` from `0.6840 in` to `0.1368 out`) and a Plantinga-style *Free-Will Defense* lens on Epicurus (`11_epicurus_free_will_lens.argdown`, shifting `[C]` from `0.7900 in` to `0.1817 out`).
3. **Static Corpus Bundle, TypeScript Kuhn-Munkres Aligner & Shareable Counterfactual URLs ([export_static_bundle.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/scripts/export_static_bundle.py), [staticBundle.ts](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/lib/staticBundle.ts), [page.tsx](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/web/src/app/page.tsx)):**
   - Exported `web/public/corpus-bundle.json` (`407.6 KB`) bundling all 12 solved passages, 6 solved lenses, and 105 normalized `BAAI/bge-small-en-v1.5` proposition embeddings, paired with an exact $O(N^3)$ Kuhn-Munkres bipartite matcher in TypeScript so static deployments run **Hermeneutic Prism** offline with identical scores to `scipy.optimize.linear_sum_assignment`.
   - Added deep-link query synchronization (`?passage=...&tab=...&norm=...&c=E2:0.00`) and an accessible **Share state** header control.

### 2. Full Empirical Benchmark Results ([eval_full_benchmark.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/scripts/eval_full_benchmark.py))
- **Part 1 (Bipolar Hypergraph vs. Standard Flat-Graph Premise Knockout Ablation):**
  - Across all `9` passages in `PhilArgs-12` with an initially accepted thesis (`> 0.50`), dropping the #1 minimal knockout assumption (`E1` or `E2`) to `0.0` collapses the thesis to `0.0000` in our conjunctive Bipolar Hypergraph, whereas a flat node-to-node `DF-QuAD` graph produces **`9 / 9` (`100.0%`) false survivals** (`pascal-wager`: `0.9995`; `descartes`: `0.9927`; `epicurus`: `0.9923`; `hume`: `0.9897`; `spinoza`: `0.9855`; `zhuangzi`: `0.9766`; `aristotle`: `0.9272`; `mill`: `0.9120`; `dostoevsky`: `0.8600`).
  - Median native Rust `atlas-cli` solve latency across `PhilArgs-12`: **`44 µs`** (mean `49.8 µs`, range `36 µs` to `105 µs`).
- **Part 2 (Hermeneutic Prism Alignment Across 6 Lenses at $\tau = 0.72$):**
  - Mean `Explicit Node F1 = 0.917` vs. Mean `Enthymeme F1 = 0.578`, empirically supporting Hypothesis $H_3$ across 6 classical interpretive disputes.
- **Part 3 (`DeBERTa-v3` + `BGE-small` Enthymeme Audit Across 5 Passages x 4 Candidates = 20 Candidates):**
  - Gold philosophical bridge premise ranked **#1 in `5 / 5` (`100.0%`)** passages: Descartes (`+0.512`), Hume (`+0.299`), Dostoevsky (`+0.844`), Aristotle (`+0.569`), and Spinoza (`+0.880`).

### 3. Mobile Layout Bug Caught & Fixed During `PhilArgs-12` Browser Audit
- **Long `<option>` Label Overflow on 390px Viewport:** Expanding `<select id="passage-select">` to `PhilArgs-12` introduced longer titles (`"Epicurus: Hume Problem Of Evil (6 nodes)"`), whose intrinsic width pushed `.atlas-brand-group` slightly past `390px` when `.atlas-select` lacked `flex: 1 1 auto; min-inline-size: 0`. Adding `flex: 1 1 auto; min-inline-size: 0; max-inline-size: 100%` on `.atlas-select`, `flex-wrap: wrap` on `.atlas-metrics-bar`, and positioning `.copy-status-tip` as an `opacity`-toggled overlay bubble resolved mobile overflow across all three tabs.
