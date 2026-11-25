# Contributing to Argument Atlas

Contributions from philosophy students, digital humanities researchers, and systems or ML engineers are welcome. You can add a new philosophical passage in about five minutes without touching Rust or PyTorch.

---

## 1. Add a new passage to `PhilArgs` (easiest first PR)

### Public-domain rule
Modern translations of ancient or foreign works remain under copyright even when the original author died centuries ago. For example, Pevear and Volokhonsky's Dostoevsky translation is copyrighted, while Constance Garnett's 1912 translation is in the public domain.

Only submit source passages that are:
- Pre-1929 public-domain English texts or translations (Jowett for Plato, Elwes for Spinoza, Meiklejohn or Abbott for Kant, Giles for Zhuangzi, Hume or Mill in original English), or
- Original public-domain / CC0 formulations you wrote yourself.

### Step-by-step `.argdown` workflow

1. Create a numbered file in `datasets/phil-args/`, such as `13_locke_personal_identity.argdown`.
2. Compute exact `[start..end]` character offsets for each verbatim quote:

```bash
python3 -c '
src = "Paste your exact source_text paragraph here."
quote = "Paste one exact substring here"
start = src.index(quote)
print(f"span: {start}..{start + len(quote)}")
'
```

3. Write your propositions and relations:
   - `[ID]: Statement {type: explicit_premise, credence: 0.9000, speaker: "Name", span: 0..42, quote: "..."}`
   - `[E1]: Unspoken bridge assumption {type: enthymeme, credence: 0.8000, speaker: "Name (Implicit)"}`
   - `<H1>: [P1] & [E1] +> [C] {weight: 0.9500, scheme: modus_ponens}` (conjunctive support hyperedge)
   - `<R1>: [Obj] -> [C] {weight: 0.9000}` (direct rebuttal of a claim)
   - `<UND1>: [Obj] _> <H1> {weight: 0.9000}` (Pollock undercutter of an inference link)

4. Verify your file against the strict Rust span and solver checks:

```bash
cargo run --release -p atlas-cli -- inspect datasets/phil-args/13_locke_personal_identity.argdown --strict-spans
```

5. Refresh the browser static bundle and run the test suite:

```bash
make bundle
make test
```

---

## 2. Add a rival Hermeneutic Lens

Want to show how two philosophical traditions read the same passage differently? Add a `.argdown` file in `datasets/hermeneutic-lenses/` with three extra frontmatter keys:

```yaml
---
passage_id: locke-reid-brave-officer-lens
target_passage_id: locke-personal-identity
lens_title: "Thomas Reid Brave Officer Critique"
lens_summary: "Introduces Reid's transitivity counterexample against memory-based personal identity."
source_text: "..."
---
```

Run `./target/release/atlas-cli inspect <your-file> --strict-spans` and `make bundle` to see it appear automatically in the **Hermeneutic Prism** tab.

---

## 3. High-impact open ideas

- **Classical Asian & Global Philosophy:** Nagarjuna's *Mulamadhyamakakarika* (tetralemma on causation), Mencius vs. Xunzi on human nature, Nyaya inference (*anumana*) five-member syllogisms, Ibn Sina's *Floating Man*.
- **Epistemology & Metaphysics:** Sextus Empiricus (*Agrippa's Trilemma*), Berkeley's *Master Argument*, Leibniz's *Principle of Sufficient Reason*, Russell's *Inductive Chicken*.
- **Solver & Visualization:** Additional gradual semantics (`Euler-based`, `h-Categorizer` alongside `DF-QuAD`) in `crates/atlas-core/src/gradual.rs`.
