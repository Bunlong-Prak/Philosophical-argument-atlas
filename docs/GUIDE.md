# Visual guide to Argument Atlas

This page explains how Argument Atlas works using short examples instead of long walls of math. Read any section on its own in two minutes.

## 1. The big picture

Imagine you paste a paragraph from Kant, Dostoevsky, or Zhuangzi. Four steps turn that paragraph into a formal structure you can test:

```text
[1. Raw Text]  -->  [2. Quotes Checked]  -->  [3. Hidden Assumptions Audited]  -->  [4. Rust / Wasm Solver]
                       (no fake quotes)          (no lazy "If P then C")              (~50 us math)
```

1. **Quotes checked:** Every explicit claim points to exact `[start..end]` character offsets in the source text. If an LLM invents a quote, the grounder drops it.
2. **Hidden assumptions audited:** A local `DeBERTa-v3` NLI model checks whether a proposed unspoken assumption (*enthymeme*) bridges the logical gap from premises to conclusion without circularity.
3. **Rust and WebAssembly solver:** `atlas-core` (and its `349 KB` browser build `atlas-wasm`) runs continuous belief propagation and discrete Dung logic in about 50 microseconds.

## 2. Four ideas, explained with real philosophy

### Idea A: Linked premises need hyperedges (Descartes)

In flat arrow graphs, two premises pointing at a conclusion act like two separate doors: close one, and the other still lets 100% of its support leak through. Across our `PhilArgs-12` ablation ([eval_full_benchmark.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/scripts/eval_full_benchmark.py)), flat graphs leave defeated theses falsely surviving above `0.86` in `9 / 9` cases (`100%`).

Philosophical arguments work like a locked chain where every premise in an inference step is required together:

```text
  [P1] "I am thinking" (1.00)  ----\
                                    +==[H1]==>  [C] "I exist" (0.74)
  [E1] "Whatever thinks exists"(0.9)/
```

Because `H1` is a **conjunctive hyperedge** (`[P1] & [E1] +> [C]`), setting `E1` to `0.0` (Lichtenberg's objection that `"it thinks"` does not prove a persistent `"I"`) collapses `H1` and `C` to `0.0`, even while `P1` stays at `1.0`. Try it in [01_descartes_cogito.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/01_descartes_cogito.argdown).

### Idea B: Undercutters and reinstatement (Plato and Zhuangzi)

There are two distinct ways to challenge an argument:

1. **Rebuttal (`->`):** Attack a proposition directly ("Your claim is false").
2. **Undercutter (`_>`):** Attack the inference gate ("Even if your premise is true, your bridge to the conclusion fails").

```text
  [P1] "Minnows dart at ease" & [E1] ====[H1]====> [C] "Zhuangzi knows the joy of fish" (0.75 in)
                                           ^
                                           |  (Undercut _> crushed to 0.05)
  [D1] & [D2] (Zhuangzi's counter) ---> [O_hui] "You are not a fish; how can you know?" (0.05 out)
```

In [04_plato_euthyphro_dilemma.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/04_plato_euthyphro_dilemma.argdown), Socrates' undercutter shrinks Euthyphro's `<H1>` gate down to `0.1191`. In [12_zhuangzi_joy_of_fish.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/12_zhuangzi_joy_of_fish.argdown), Huizi undercuts Zhuangzi (`O_hui _> <H1>`), and Zhuangzi defeats `O_hui` right back (`D1` and `D2 -> O_hui`), reinstating `<H1>` and `[C] = 0.7502 (in)`.

### Idea C: Deadlocks split into two worlds (Kant)

What happens when two arguments attack each other with equal force?

In [05_kant_third_antinomy.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/05_kant_third_antinomy.argdown), `Thesis` (free causality) and `Antithesis` (universal determinism) attack each other symmetrically (`Thesis <-> Antithesis`):
- **Continuous math (`DF-QuAD`):** Damped relaxation converges cleanly to a tie at `0.4000` instead of oscillating forever.
- **Discrete Dung logic:** `Grounded` marks both `undecided`, while `Preferred` extensions split into two internally consistent worldviews (`{Thesis}` vs. `{Antithesis}`).

### Idea D: Catching circular AI assumptions (`DeBERTa-v3`)

Ask an LLM for the missing premise between `P` and `C`, and it often cheats:
- **Tautology cheat:** `"If P, then C."` (Passes Modus Ponens on paper, adds zero philosophical content.)
- **Usurpation cheat:** Paraphrases `C` directly so `P` becomes irrelevant.

Our scorer in [nli_enthymeme.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/nli_enthymeme.py) combines three checks:
1. **Gain (`delta_nli`):** Does `P + E` entail `C` substantially better than `P` alone?
2. **Circularity (`usurpation_score`):** Does `E` entail or paraphrase `C` by itself?
3. **Tautology (`triviality_penalty`):** Does `E` match `"If P, then C"` without adding new concepts?

Across Descartes, Hume, Dostoevsky, Aristotle, and Spinoza (`make benchmark`), this scorer ranks the true philosophical bridge #1 in `5 / 5` passages (`100%`).

## 3. One-minute file map

```text
argument-atlas/
├── crates/atlas-core/src/         <-- Rust hypergraph types, DF-QuAD, Dung, knockouts, .argdown
├── crates/atlas-wasm/src/lib.rs   <-- Browser WebAssembly C-ABI exports (349 KB .wasm)
├── crates/atlas-cli/src/main.rs   <-- Terminal commands (inspect, solve, convert)
├── datasets/phil-args/            <-- PhilArgs-12 strict-span public-domain corpus
├── datasets/hermeneutic-lenses/   <-- 6 rival philosophical lenses for comparison
├── backend/src/atlas_ml/          <-- Span grounder, Rust IPC, DeBERTa-v3 NLI, aligner, FastAPI
├── backend/scripts/               <-- Benchmark & static bundle scripts (eval_full_benchmark.py)
└── web/src/                       <-- Next.js 16 + React Flow Workbench + Wasm + Share URLs
    ├── app/                       <-- Top workbench layout, CSS tokens, URL query state
    ├── components/                <-- SourceReader, HypergraphCanvas, ApparatusInspector, Prism, Lab
    └── lib/                       <-- wasmSolver.ts, staticBundle.ts (Kuhn-Munkres), elkLayout.ts
```

## 4. Using the Visual Workbench (`web/`)

You can run `cd web && npm run dev` on its own (zero-backend Wasm mode) or alongside `make dev-api` (full Python ML mode). Open `http://localhost:3000`:

### Tab 1: Dialectical Workbench
- **Left pane (`SourceReader`):** Displays the primary passage with clickable quote underlines (`[P1]`, `[C]`) and dashed amber cards for unspoken assumptions (`[E1]`).
- **Center pane (`HypergraphCanvas`):** Draws propositions and conjunctive `<H>` gates via ELK and React Flow. Knock out an assumption and watch its gate flip to `SEVERED`.
- **Right pane (`ApparatusInspector`):** Drag credence sliders (`0.00` to `1.00`) at 60fps via `atlas-wasm`, click **Test** on any **Minimal Knockout**, switch between **Godel min** and **Product** T-norms, and click **Share state** in the top header to copy a counterfactual URL (`?passage=pascal-wager&c=E2:0.00`).

### Tab 2: Hermeneutic Prism
- Compare **Reading A** and **Reading B** across all 6 rival philosophical lenses (including Diderot's *Many-Gods* critique of Pascal and the *Free-Will Defense* against Epicurus).
- Drag **Cosine Similarity Threshold (`tau`)** from `0.45` to `0.95` to inspect matched claims, structural F1 scores, and `Thesis Outcome Shift` (works both via FastAPI `/api/align` and offline via pre-computed `BGE-small` vectors in `corpus-bundle.json`).

### Tab 3: Custom Text & NLI Lab
- **Right card (`.argdown` Offline):** Write or paste any `.argdown` specification and parse + solve it directly in the browser via WebAssembly.
- **Left card (`DeBERTa-v3` Enthymeme Auditor) & Raw Text (`LLM`):** Connect local FastAPI (`make dev-api`) to audit candidate hidden assumptions with PyTorch `DeBERTa-v3` or extract graphs from raw prose via Groq, OpenAI, Anthropic, or Ollama.

## 5. Talking to the Python API

Start FastAPI on port `8000` (`make dev-api`) and open interactive Swagger docs at `http://127.0.0.1:8000/docs`:
- `GET /passages` and `GET /passages/{id}` serve all 12 solved corpus passages.
- `GET /hermeneutic-lenses` serves all 6 rival philosophical lenses.
- `POST /solve` and `POST /parse-argdown` run native Rust solving and `.argdown` parsing.
- `POST /score-enthymemes` ranks candidate hidden assumptions with local `DeBERTa-v3`.
- `POST /align` aligns any two hypergraphs using live `BAAI/bge-small-en-v1.5` embeddings.
- `POST /extract` and `POST /compare-text` run multi-provider LLM extraction and cross-model comparison (returning HTTP `503` when required cloud keys are unset).
