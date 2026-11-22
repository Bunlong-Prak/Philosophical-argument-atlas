# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js + React + TypeScript + React Flow (`@xyflow/react`) + ELK (`elkjs`) layered graph, connecting to the local FastAPI + Rust (`atlas-core`) backend in `backend/`.

## Users

Philosophy students, digital humanities researchers, and AI/ML engineers inspecting primary philosophical arguments, implicit assumptions (*enthymemes*), and formal belief propagation.

## Product Purpose

An interactive split-pane dialectical workbench where users select a primary passage, read source-grounded claims alongside a layered Bipolar Argumentation Hypergraph, and drag live credence sliders on explicit premises or hidden assumptions to watch acceptability scores and Dung extensions recompute in real time.

## Positioning

Unlike generic node-link diagrams or single-answer LLM summaries, Argument Atlas models conjunctive support hyperedges, Pollock undercutting attacks on inference gates, NLI-audited hidden premises, and exact Rust `DF-QuAD` + Dung extension solvers backed by verified source character spans.

## Operating Context

Used primarily in calm daylight reading sessions on desktop viewports, paired with the local FastAPI API (`http://127.0.0.1:8000`) and the curated public-domain corpus in `datasets/phil-args/`.

## Capabilities and Constraints

- Strict Unicode character-span alignment (`[start_char..end_char]`) between primary text and explicit graph nodes.
- Real-time gradual `DF-QuAD` propagation, Dung acceptability labels (`In`, `Out`, `Undecided`), and Minimal Premise Knockout discovery via Rust `atlas-core`.
- Optional custom `.argdown` / raw text extraction via `/solve-argdown` and `/extract`, plus `DeBERTa-v3` NLI enthymeme auditing via `/score-enthymemes`.
- Visual aesthetic preference confirmed by user: calm daylight archival paper (warm off-white ground, crisp ink typography, high contrast for reading philosophy).

## Evidence on Hand

- `datasets/phil-args/`: 6 public-domain philosophical passages (Descartes, Hume, Dostoevsky, Plato, Kant, Mill) with verified verbatim spans.
- `crates/atlas-core` & `crates/atlas-cli`: Rust formal solvers and CLI (`8/8` unit tests passing, `<0.1ms` release solve latency).
- `backend/src/atlas_ml`: Python ML/NLI backend, FastAPI service, and graph aligner (`8/8` pytest passing).

## Product Principles

- Ground every explicit claim in verbatim primary text rather than unverified paraphrases.
- Treat linked premises as conjunctive hyperedges and inference attacks as undercutters rather than flat binary arrows.
- Keep the workbench scannable and calm: progressive disclosure, clear state feedback, and animation strictly tied to solver state changes.
- Expose uncertainty and competing extensions (`Undecided`, multi-world `Preferred`) instead of forcing artificial consensus.

## Accessibility & Inclusion

- ADHD-friendly scannable hierarchy with clear visual anchors and low-clutter controls.
- Full keyboard navigation, native `<input type="range">` sliders, WCAG AA contrast (>= 4.5:1 body text), and strict respect for `prefers-reduced-motion`.
