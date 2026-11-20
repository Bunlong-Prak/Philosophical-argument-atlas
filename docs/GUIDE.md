# Visual Guide to Argument Atlas

This page explains how Argument Atlas works using short examples instead of long walls of math. Read any section on its own in two minutes.

---

## 1. The big picture (in one picture)

Imagine you paste a paragraph from Kant or Dostoevsky. Four steps turn that paragraph into something you can test:

```text
[1. Raw Text]  -->  [2. Quotes Checked]  -->  [3. Hidden Assumptions Audited]  -->  [4. Rust Solver]
                       (no fake quotes)          (no lazy "If P then C")              (0.1 ms math)
```

1. **Quotes checked:** Every explicit claim must point to exact `[start..end]` character positions in the source text. If an AI invents a quote, the grounder drops it.
2. **Hidden assumptions audited:** A local `DeBERTa-v3` NLI model checks whether a proposed unspoken assumption (*enthymeme*) actually bridges the gap from premises to conclusion.
3. **Rust solver:** `atlas-core` runs formal logic and gradual belief math over the whole graph in about 50 to 100 microseconds.

---

## 2. Four ideas, explained with real philosophy

### Idea A: Linked premises need hyperedges (Descartes)

In normal arrow graphs, two premises pointing at a conclusion act like two separate doors: close one, and the other still lets you through.

Philosophical arguments usually work like a locked chain where every link is required at once.

```text
  [P1] "I am thinking" (1.00)  ----\
                                    +==[H1]==>  [C] "I exist" (0.90)
  [E1] "Whatever thinks exists"(0.9)/
```

Because `H1` is a **conjunctive hyperedge** (`[P1] & [E1] +> [C]`), setting `E1` to `0.0` (Lichtenberg's objection that "it thinks" does not prove a persistent "I") collapses `H1` to `0.0`, even while `P1` stays at `1.0`.

Try it in [01_descartes_cogito.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/01_descartes_cogito.argdown).

---

### Idea B: Attacking a claim vs. attacking an arrow (Plato)

There are two completely different ways to disagree with an argument:

1. **Rebuttal (`->`):** Attack the claim directly ("Your conclusion is false").
2. **Undercutter (`_>`):** Attack the inference arrow ("Even if your premise is true, it does not prove your conclusion").

```text
  [P1] "Piety is what the gods love" ====[H1]====> [C] "Gods' love makes it holy"
                                           ^
                                           |  (Undercut _>)
  [U1] "Gods love it BECAUSE it is already holy"
```

In [04_plato_euthyphro_dilemma.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/04_plato_euthyphro_dilemma.argdown), Socrates' objection `U1` undercuts `<H1>`, shrinking its effective transmission from `0.78` down to `0.1191`.

---

### Idea C: Deadlocks split into two worlds (Kant)

What happens when two arguments attack each other with equal force?

In [05_kant_third_antinomy.argdown](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/datasets/phil-args/05_kant_third_antinomy.argdown):
- **Thesis:** Free causality must exist to avoid an infinite regress.
- **Antithesis:** Everything follows deterministic laws of nature with zero freedom.
- Both attack each other (`Thesis <-> Antithesis`).

Two things happen when `atlas-cli` solves Kant's antinomy:
- **Continuous math (`DF-QuAD`):** Both settle into a tie at `0.4000` (using damped updates so the cycle converges instead of bouncing forever).
- **Discrete Dung logic:** `Grounded` leaves both `Undecided`, while `Preferred` extensions split cleanly into two consistent worldviews: one containing `Thesis`, and one containing `Antithesis`.

---

### Idea D: Catching circular AI assumptions (`DeBERTa-v3`)

Ask an LLM for the hidden assumption between Premise `P` and Conclusion `C`, and it often cheats in two ways:
- **Tautology cheat:** `"If P, then C."` (Technically makes Modus Ponens pass, adds zero philosophical substance.)
- **Usurpation cheat:** Restates `C` directly so `P` is not needed at all.

Our NLI scorer in [nli_enthymeme.py](file:///Users/mac/Projects/personal/Philosophy_in_AI/argument-atlas/backend/src/atlas_ml/nli_enthymeme.py) scores candidate assumptions across three checks:
1. **Gain (`delta_nli`):** Does `P + E` entail `C` much better than `P` alone?
2. **Circularity (`usurpation_score`):** Does `E` entail `C` by itself, or paraphrase `C`?
3. **Tautology (`triviality_penalty`):** Does `E` closely match `"If P, then C"` while introducing little or no new vocabulary?

You can watch those numbers live across Descartes, Hume, and Dostoevsky by running:

```bash
cd backend && uv run python scripts/eval_enthymeme_ablation.py
```

---

## 3. One-minute file map

When you want to change something, jump straight to that folder:

```text
argument-atlas/
├── crates/atlas-core/src/
│   ├── model.rs        <-- Graph types + exact character span check
│   ├── gradual.rs      <-- DF-QuAD continuous belief propagation
│   ├── dung.rs         <-- Grounded / Preferred / Stable extension solver
│   ├── knockout.rs     <-- Finds weakest assumptions to collapse a thesis
│   └── argdown.rs      <-- Reads and writes .argdown files
├── crates/atlas-cli/src/main.rs   <-- Terminal commands (inspect, solve, convert)
├── datasets/phil-args/            <-- 6 curated public-domain passages
└── backend/src/atlas_ml/
    ├── schemas.py      <-- Python models + quote repair (DeterministicSpanGrounder)
    ├── rust_bridge.py  <-- Calls compiled Rust binary over JSON stdin/stdout
    ├── nli_enthymeme.py<-- Local DeBERTa-v3 + BGE-small assumption scorer
    ├── graph_aligner.py<-- Compares two graphs via Hungarian matching
    ├── extractor.py    <-- LLM JSON extractor -> grounder -> NLI -> Rust
    └── api.py          <-- FastAPI HTTP endpoints (/passages, /solve, /align, /extract)
```

---

## 4. Talking to the API

Start the backend:

```bash
cd backend
uv run uvicorn atlas_ml.api:app --reload
```

Useful endpoints right away (open interactive docs at `http://127.0.0.1:8000/docs`):
- `GET /passages` lists all 6 curated passages.
- `GET /passages/kant-third-antinomy` returns the full hypergraph, `.argdown` text, and solver output.
- `POST /solve` takes any modified hypergraph (for instance, changing a premise's `base_credence` from `0.9` to `0.0`) and returns updated `DF-QuAD`, `Dung`, and knockout outputs.
- `POST /score-enthymemes` ranks candidate hidden assumptions using local `DeBERTa-v3`.
- `POST /align` aligns two graphs for cross-model comparison.
- `POST /extract` extracts a hypergraph from raw text using Groq, OpenAI, Anthropic, or local Ollama (returns HTTP `503` with instructions if the cloud API key is unset).
