---
name: "Argument Atlas"
description: "Critical-Edition Apparatus for neuro-symbolic dialectical hypergraphs, source-grounded philosophical prose, and live belief propagation."
colors:
  cobalt: "#1d4ed8"
  cobalt-soft: "#eff6ff"
  cobalt-border: "#93c5fd"
  sienna: "#b45309"
  sienna-soft: "#fffbeb"
  sienna-border: "#fcd34d"
  crimson: "#b91c1c"
  crimson-soft: "#fef2f2"
  crimson-border: "#fca5a5"
  forest: "#15803d"
  forest-soft: "#f0fdf4"
  forest-border: "#86efac"
  paper-canvas: "#f7f5f0"
  paper-reading: "#faf8f4"
  paper-rail: "#eeece4"
  paper-card: "#ffffff"
  ink-primary: "#1a1d24"
  ink-secondary: "#4a4640"
  ink-muted: "#6b655c"
  rule-hairline: "#d8d3c6"
  rule-strong: "#b8b1a1"
typography:
  headline:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  prose:
    fontFamily: "Newsreader, Georgia, Times New Roman, serif"
    fontSize: "1.15rem"
    fontWeight: 400
    lineHeight: 1.78
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.4
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.5
    fontFeature: "tnum"
rounded:
  xs: "3px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.paper-card}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.65rem"
    height: "32px"
  button-toggle-sienna:
    backgroundColor: "{colors.sienna-soft}"
    textColor: "{colors.sienna}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.3rem 0.7rem"
    height: "34px"
  button-knockout:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.crimson}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.2rem 0.55rem"
    height: "30px"
  input-field:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.55rem"
    height: "38px"
  tab-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    padding: "0.4rem 0.9rem"
    height: "38px"
  tab-item-active:
    backgroundColor: "transparent"
    textColor: "{colors.cobalt}"
    typography: "{typography.label}"
    padding: "0.4rem 0.9rem"
    height: "38px"
  latency-pill:
    backgroundColor: "{colors.paper-reading}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.data}"
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.6rem"
  proposition-card:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    width: "276px"
  inference-gate:
    backgroundColor: "{colors.cobalt-soft}"
    textColor: "{colors.cobalt}"
    typography: "{typography.data}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
    width: "152px"
    height: "44px"
  inspector-card:
    backgroundColor: "{colors.paper-reading}"
    textColor: "{colors.ink-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.65rem 0.75rem"
---

# Design System: Argument Atlas

## Overview

**Creative North Star: "Critical-Edition Apparatus"**

Argument Atlas is built as a calm daylight scholarly workbench that places primary philosophical text beside a live formal hypergraph engine. Instead of treating formal reasoning as a dark sci-fi node-cockpit or a generic gray SaaS dashboard, the visual system models the tactile clarity of a printed critical edition: warm cotton-paper surfaces, crisp charcoal ink, hairline rules, and high-contrast dialectical accents.

Three warm paper values separate structural regions without heavy drop shadows: a muted cotton canvas (`#f7f5f0`) anchors the middle graph stage and Lab workspace, a brighter reading sheet (`#faf8f4`) holds primary philosophical prose and inspector sub-cards, and a quiet apparatus rail (`#eeece4`) frames the top bar and right assumption inspector. Across every pane, color encodes logical role consistently rather than acting as decorative ornament.

Interactive behavior centers on synchronized inspection and live collapse feedback. Hovering or selecting a claim illuminates its verbatim source span, graph card, and credence slider together, while lowering premise credence dims collapsed nodes (`<= 0.08` acceptability) and turns severed hyperedge gates (`<= 0.05` transmission) dashed in step with the Rust `DF-QuAD` solver.

**Key Characteristics:**
- Warm three-surface cotton paper palette (`#f7f5f0`, `#faf8f4`, `#eeece4`) divided by `1px` stone hairline rules (`#d8d3c6`).
- Tri-font editorial hierarchy pairing Newsreader serif for philosophical prose with IBM Plex Sans for controls and tabular JetBrains Mono for formal scores.
- Synchronized dialectical ink system across source highlights, ELK hypergraph geometry, and native range sliders.
- Structural state redundancy using dashed borders, `3px` active tab rules, and `2px` underline bars alongside semantic color shifts.
- Motion strictly tied to solver and hover state (`180ms` to `200ms` ease-out) and suppressed under `prefers-reduced-motion`.

## Colors

A light-mode archival cotton palette anchored by charcoal ink and four semantic dialectical ink families (`cobalt`, `sienna`, `crimson`, `forest`).

### Primary
- **Oxford Cobalt** (`#1d4ed8`): Primary action buttons (`Score Candidates`, `Parse & Open in Workbench`), active workspace tabs (`aria-selected="true"` text and `3px` bottom bar), keyboard focus outlines (`3px solid`), intact thesis node borders, explicit premise span underlines, active support hyperedges, and premise range sliders.
- **Cobalt Wash** (`#eff6ff`): Soft tint for intact inference gate pills, active Custom Lab input-mode toggle buttons, intact target thesis summary cards (`> 0.50`), and hovered or selected implicit assumption buttons.
- **Cobalt Hairline** (`#93c5fd`): `1.5px` border stroke framing the intact target thesis summary card in `ApparatusInspector`.

### Secondary
- **Burnt Sienna** (`#b45309`): Unspoken hidden assumptions (`enthymeme` nodes) and Pollock undercutting attacks on inference gates. Applied to dashed enthymeme card borders, undercut or severed gate borders, the `Enthymemes Visible` toggle button, enthymeme sliders, and dashed undercutting edges.
- **Sienna Cream** (`#fffbeb`): Warm tinted fill for enthymeme graph cards, unspoken assumption list buttons, undercut or severed inference gate pills, and the active `Enthymemes Visible` toggle.
- **Sienna Border** (`#fcd34d`): Declared in `:root` (`--sienna-border`) as the light amber companion border token for sienna surfaces.

### Tertiary
- **Archival Crimson** (`#b91c1c`): Direct rebuttals (`rebuts` edges and `objection` propositions), objection credence sliders, collapsed thesis states (`<= 0.08` on graph, `<= 0.50` in inspector), minimal knockout cards, `Test` knockout buttons, and error alerts.
- **Crimson Tint** (`#fef2f2`): Soft alert fill for objection node cards, collapsed thesis cards and banners, minimal knockout rows, and error alerts.
- **Crimson Hairline** (`#fca5a5`): `1px` or `1.5px` border stroke around minimal knockout cards, collapsed thesis banners, and error alerts.
- **Forest Thesis** (`#15803d`): Verbatim thesis span underline in `SourceReader` and `valid_bridge` verdict headers in the DeBERTa-v3 Enthymeme Auditor.
- **Forest Mist** (`#f0fdf4`): Soft background wash for `valid_bridge` NLI result cards.
- **Forest Hairline** (`#86efac`): `1px` border stroke around `valid_bridge` NLI result cards.

### Neutral
- **Archival Cotton Canvas** (`#f7f5f0`): Root document ground, React Flow hypergraph canvas background, and Custom Lab backdrop.
- **Reading Sheet** (`#faf8f4`): Left source-reader column, graph legend strip, solver latency pill background, inspector slider cards, Dung extensions block, and Lab module panels.
- **Apparatus Rail** (`#eeece4`): Top navigation header, right assumption inspector rail, `.argdown` preformatted block, and scrollbar track.
- **Elevated Paper Card** (`#ffffff`): Proposition cards at rest, `<select>` dropdowns, text inputs and textareas, React Flow zoom controls, and inactive secondary buttons.
- **Deep Charcoal Ink** (`#1a1d24`): Primary body text, headings, philosophical source prose, active proposition text, and input values.
- **Graphite Secondary Ink** (`#4a4640`): Inactive tab labels, header metric text, legend labels, slider proposition summaries, and inline span `[ID]` superscripts.
- **Stone Muted Ink** (`#6b655c`): Speaker attribution captions, empty-state guidance, subtle canvas instructions, and NLI metric breakdowns.
- **Hairline Stone Rule** (`#d8d3c6`): `1px` structural dividers between workbench panes, header bottom rule, latency pill border, and resting inspector card borders.
- **Strong Stone Rule** (`#b8b1a1`): `1px` interactive borders on `<select>`, `<input>`, `<textarea>`, and secondary or toggle buttons.

### Named Rules
**The Tri-Surface Paper Rule.** Assign `#f7f5f0` only to open spatial canvas grounds, `#faf8f4` to reading prose and nested cards, and `#eeece4` to persistent apparatus chrome so regions separate cleanly without heavy framing.

**The Dialectical Ink Rule.** Reserve Oxford cobalt (`#1d4ed8`) for explicit support and primary controls, burnt sienna (`#b45309`) strictly for implicit assumptions and undercutters, and archival crimson (`#b91c1c`) strictly for rebuttals, collapses, and errors. Never swap semantic inks for decorative badges.

## Typography

**Display Font:** None distinct; section and apparatus headings use `IBM Plex Sans` (`--font-sans`, mapped to `--font-ui`) with `system-ui, -apple-system, sans-serif` fallback.
**Body Font:** `IBM Plex Sans` (`--font-ui`) for interface controls and graph cards; `Newsreader` (`--font-serif`, mapped to `--font-prose`, weights `400`, `500`, `600`, normal and italic) with `Georgia, "Times New Roman", serif` fallback strictly for philosophical primary-text prose and the LLM passage textarea.
**Label/Mono Font:** `JetBrains Mono` (`--font-mono`, mapped to `--font-data`, weights `400`, `500`, `600`) with `ui-monospace, SFMono-Regular, monospace` fallback and `font-variant-numeric: tabular-nums` via `.tabular-data`.

**Character:** Editorial clarity paired with instrument precision. Newsreader lends literary cadence to long-form philosophical passages, while IBM Plex Sans and tabular JetBrains Mono keep controls, formal node identifiers, and microsecond solver readouts legible at compact workbench densities.

### Hierarchy
- **Headline** (`700`, `1.2rem` / `18px`, `-0.015em` tracking): Passage title in `SourceReader` (`h2#reader-heading`).
- **Title** (`700`, `0.98rem` to `1.05rem` / `14.7px` to `15.75px`, `-0.015em` tracking): Top bar title (`.atlas-title`), Lab section headings (`1.05rem`), and inspector heading (`0.98rem`).
- **Prose** (`400`, `1.15rem` / `17.25px`, `1.78` line height, `62ch` max measure): Verbatim primary philosophical text (`.passage-prose`) set in `Newsreader`.
- **Body** (`400`, `15px` root / `12.5px` inside graph node cards, `1.5` or `1.4` line height): Workbench prose, form inputs, NLI explanations, and graph proposition statements.
- **Label** (`500` to `700`, `0.76rem` to `0.9rem` / `11.4px` to `13.5px`, `1.35` to `1.5` line height): Mode tabs (`0.9rem`, `500`/`600`), passage selector (`0.9rem`, `500`), field labels (`0.82rem`, `600`), and compact buttons (`0.75rem` to `0.82rem`, `600`).
- **Tabular Data** (`400` to `700`, `0.73rem` to `1.05rem`, `tabular-nums`): Node identifiers (`[P1]`, `<H1>`), solver latency pill (`0.82rem`), target thesis score (`1.05rem`), slider readouts (`0.82rem`), knockout costs (`0.73rem`), and `.argdown` code blocks (`0.75rem` to `0.82rem`).

### Named Rules
**The Two-Voice Type Rule.** Keep `Newsreader` dedicated to primary philosophical passages and passage input, and keep `IBM Plex Sans` on all apparatus headings and controls so commentary never blurs into source text.

**The Tabular Numerals Rule.** Apply `.tabular-data` (`JetBrains Mono` with `font-variant-numeric: tabular-nums`) to every live acceptability score, slider value, latency readout, and node index so dragging sliders never causes layout jitter.

## Layout

The desktop workbench renders as a full-viewport two-row CSS Grid (`.atlas-shell`, `grid-template-rows: auto 1fr`, `100dvh` height, `overflow: hidden`) where each pane manages its own scroll context:

- **Top Apparatus Header (`.atlas-header`):** Wrapping flexbox bar (`gap: 0.75rem 1.25rem`, `padding: 0.625rem 1.25rem`) aligning the `Argument Atlas` title and `#passage-select` dropdown on the left, accessible workspace tabs in the center, and the Rust solver latency pill on the right.
- **Three-Pane Workbench Grid (`.workbench-grid`):** `grid-template-columns: minmax(320px, 410px) minmax(0, 1fr) minmax(290px, 330px)` across `reader`, `canvas`, and `inspector`. Reader (`1.5rem 1.5rem 2rem` padding) and inspector (`1.25rem 1.15rem 2rem` padding) scroll independently with `scrollbar-gutter: stable` and `overscroll-behavior: contain`. The center React Flow pane (`min-block-size: 460px`) renders an ELK bottom-to-top layered DAG (`elk.direction: UP`, `elk.spacing.nodeNode: 44`, `elk.layered.spacing.nodeNodeBetweenLayers: 58`, `elk.edgeRouting: SPLINES`).
- **Responsive Collapse (`max-width: 1120px`):** Below `1120px`, `.atlas-shell` unlocks natural document scrolling (`block-size: auto`, `overflow: visible`), `.workbench-grid` collapses to a single column (`reader` -> `canvas` -> `inspector`), vertical border rules convert to `1px` bottom borders, and `.pane-canvas` assumes a `640px` block height.
- **Custom Text & NLI Lab:** Centered `max-inline-size: 1180px` grid (`repeat(auto-fit, minmax(min(100%, 340px), 1fr))`) with `1.25rem` gap and `clamp(0.85rem, 3vw, 1.5rem)` outer padding.
- **Spacing Rhythm:** Built on `0.25rem` (`3.75px` at `15px` root) steps: `0.25rem` micro gaps, `0.5rem` control spacing, `0.75rem` card padding and section margins, `1.25rem` pane and grid gaps, and `1.5rem` reading margins.

## Elevation & Depth

Argument Atlas uses a flat-by-default layered paper architecture with restrained box shadows appearing only inside the interactive spatial canvas and on range slider thumbs. Structural panes (`atlas-header`, `pane-reader`, `pane-inspector`, Lab panels) remain completely flat and rely on warm value transitions (`#faf8f4` / `#f7f5f0` / `#eeece4`) plus `1px solid #d8d3c6` hairline rules. Inside the canvas, React Flow renders over a `22px` dot background (`#cdc7b8`, `1.2px` dot size).

### Shadow Vocabulary
- **Node Card Rest** (`box-shadow: 0 2px 6px rgba(26, 29, 36, 0.06)`): Subtle lift separating proposition cards from the dotted archival canvas.
- **Node Card Hover or Selected** (`box-shadow: 0 6px 18px rgba(29, 78, 216, 0.16)`): Cobalt-tinted halo when hovering or selecting a proposition node.
- **Node Card Knockout Highlight** (`box-shadow: 0 4px 14px rgba(185, 28, 28, 0.2)`): Crimson-tinted emphasis on propositions targeted by the top minimal knockout set.
- **Inference Gate Rest** (`box-shadow: 0 1px 4px rgba(26, 29, 36, 0.07)`): Light grounding shadow on capsule-shaped conjunction gates.
- **Canvas Controls** (`box-shadow: 0 2px 8px rgba(26, 29, 36, 0.08)`): Floating React Flow zoom and fit-view bar in the lower-left canvas corner.
- **Slider Thumb** (`box-shadow: 0 1px 3px rgba(26, 29, 36, 0.25)`): Tactile ring lift for the `1.15rem` circular thumb on WebKit range sliders.

### Named Rules
**The Quiet Paper Rule.** Keep structural panes, inspector cards, and Lab panels completely shadow-free at rest; convey hierarchy with warm paper shifts and `1px` stone rules, reserving elevation strictly for spatial graph objects, floating canvas controls, and slider thumbs.

## Shapes

Geometry across the workbench carries functional clarity and logical meaning:

- **Compact Controls & Fields (`6px` radius):** `<select>` dropdowns, buttons, text inputs, textareas, `.argdown` `<pre>` blocks, unspoken assumption buttons, and the app favicon (`rx="6"`) share a consistent `6px` corner radius with `1px solid` rules (`#b8b1a1` on interactive controls, `#d8d3c6` on static blocks). Active header tabs round only the top corners (`6px 6px 0 0`) so their `3px` cobalt underline sits flush on the header divider.
- **Cards & Containers (`8px` and `10px` radius):** Proposition node cards, inspector slider cards, target thesis summary banners, knockout cards, NLI verdict cards, error banners, and React Flow controls use `8px` corners; outer Custom Lab section panels step up to `10px` corners.
- **Inline Text Highlights (`3px` radius):** Verbatim spans inside `.passage-prose` use tight `3px` corners with `box-decoration-break: clone` so multi-line philosophical quotes render crisp rounded highlights and continuous `2px` bottom underlines across line breaks.
- **Pills & Capsules (`999px` radius):** Latency readouts, Dung grounded status badges, slider tracks (`50%` circular thumbs), acceptability meter bars, and hyperedge inference gate nodes use full capsule geometry.
- **Dashed Geometry Encoding:** `dashed` borders and edges are semantic, never decorative. `1px` or `1.5px dashed` borders mark implicit enthymemes (`SourceReader` cards and `PropositionNodeCard`), undercut or severed inference gates (`InferenceGateNode`), and collapsed support or attack edges.

## Components

### Buttons
Compact, legible controls paired with `12px` to `15px` Lucide stroke icons (`0.25rem` to `0.4rem` gap, `font-weight: 600`).
- **Shape:** `6px` rounded rectangle, `30px` to `40px` minimum height.
- **Primary:** Solid `#1d4ed8` background and `1px solid #1d4ed8` border, `#ffffff` text, `0.5rem 1rem` padding, `40px` min-height (`Score Candidates`, `Parse & Open in Workbench`).
- **Hover / Focus:** Keyboard focus across all interactive controls displays a `3px solid #1d4ed8` outline with `2px` offset (`:focus-visible`).
- **Secondary / Toggle / Knockout:**
  - Secondary & Presets (`Reset`, `Descartes (Cogito)`, `Dostoevsky (Rebellion)`, inactive toggles): `#ffffff` fill, `1px solid #b8b1a1` border, `#1a1d24` or `#4a4640` text, `30px` to `34px` min-height. `Reset` drops to `transparent` fill, `#6b655c` text, and `0.6` opacity when unchanged.
  - Active Toggles: `Enthymemes Visible` uses `#fffbeb` fill with `1px solid #b45309` border and `#b45309` text; active Lab mode toggles (`.argdown (Offline)` / `Raw Text (LLM)`) use `#eff6ff` fill with `1px solid #1d4ed8` border and `#1d4ed8` text.
  - Knockout Action (`Test`): `#ffffff` fill, `1px solid #b91c1c` border, `#b91c1c` text, `30px` min-height, `0.2rem 0.55rem` padding.

### Chips
Compact status readouts and selectable semantic badges.
- **Latency Pill (`.atlas-latency-pill`):** `999px` capsule on `#faf8f4` background, `1px solid #d8d3c6` border, `0.25rem 0.6rem` padding, `0.82rem` `.tabular-data` text, and a `13px` cobalt `Activity` icon.
- **Dung Status Pill:** `999px` uppercase badge inside `PropositionNodeCard` (`1px 6px` padding, `600` weight) pairing semantic wash and ink for `in`, `out`, and `undecided`.
- **Unspoken Assumption Card:** Full-width `6px` button in `SourceReader` (`0.65rem 0.75rem` padding) using `1px dashed #b45309` border and `#fffbeb` fill at rest, switching to `1px dashed #1d4ed8` and `#eff6ff` when active.

### Cards / Containers
Structured archival containers balancing flat inspection rails with lightly lifted graph nodes.
- **Corner Style:** `8px` for proposition nodes, inspector slider cards, thesis banners, knockout cards, and NLI result cards; `10px` for Lab module containers.
- **Background & Border:**
  - Proposition Node Card (`276px` wide, `10px 12px` padding): `#ffffff` with `1.5px solid` default border for explicit premises; `#fffbeb` with `1.5px dashed #b45309` for enthymemes; `#fef2f2` with `1.5px solid #b91c1c` for objections; `2px solid #1d4ed8` for intact thesis or hovered/selected cards; `2px solid #b91c1c` for collapsed thesis (`<= 0.08`) or knockout highlights. Collapsed non-thesis, non-hovered cards dim to `0.62` opacity. Includes a `4px` tall `999px` acceptability progress bar at the card footer.
  - Inspector Slider Card (`0.65rem 0.75rem` padding): `#faf8f4` background with `1px solid #d8d3c6` border shifting to `#1d4ed8` when hovered.
  - Target Thesis Banner (`0.7rem 0.8rem` padding): `1.5px solid` box switching from `#eff6ff` / `#93c5fd` / `#1d4ed8` (`> 0.50`) to `#fef2f2` / `#fca5a5` / `#b91c1c` (`<= 0.50`).
  - Minimal Knockout Card (`0.6rem 0.7rem` padding) & Error Alert: `#fef2f2` fill with `1px solid #fca5a5` border and `#b91c1c` text.
  - Lab Section Panel (`1.25rem` padding): `#faf8f4` background with `1px solid #d8d3c6` border.
- **Shadow Strategy:** Inspector and Lab cards stay flat; canvas proposition nodes apply the Node Card shadow states defined in Elevation & Depth.

### Inputs / Fields
Accessible native form controls styled directly on light cotton-paper tokens.
- **Select Dropdown (`.atlas-select`):** `36px` min-height (`30px` for compact T-Norm selector), `0.35rem 0.75rem` padding, `1px solid #b8b1a1` border, `6px` radius, `#ffffff` fill, `0.9rem` (`500` weight) text.
- **Text Inputs & Textareas:** `#ffffff` fill, `1px solid #b8b1a1` border, `6px` radius, `0.45rem 0.55rem` or `0.55rem` padding, `38px` min-height on single-line inputs, vertical resize on textareas, and font matched to domain (`JetBrains Mono` at `0.82rem` for `.argdown`, `Newsreader` at `1rem` for passages, `IBM Plex Sans` for NLI text).
- **Credence Range Slider (`.atlas-slider`):** Native `<input type="range">` (`2.25rem` hit height, `0.45rem` `999px` track, `1.15rem` circular thumb with `2px solid #ffffff` ring and subtle drop shadow). Filled track and thumb adopt node semantics: `#1d4ed8` for premises, `#b45309` for enthymemes, and `#b91c1c` for objections. Focus adds a `3px solid` outline in the active slider ink (`2px` offset, `6px` radius).

### Navigation
Single-level header tab navigation inside `.atlas-tablist` with full keyboard arrow support (`ArrowLeft` / `ArrowRight`).
- `38px` min-height tabs with `0.4rem 0.9rem` padding, `6px 6px 0 0` top corners, `#4a4640` text, `0.9rem` font size (`500` weight), and `rgba(26, 29, 36, 0.04)` hover tint.
- Active tab (`aria-selected="true"`) uses `#1d4ed8` text (`600` weight) paired with an `::after` `3px solid #1d4ed8` bottom rule so active state never relies on hue alone.

### Signature Components
- **Source-Linked Prose Spans (`.span-highlight`):** Verbatim clickable spans (`role="button"`, `tabIndex={0}`) inside `Newsreader` prose with `1px 3px` padding, `3px` radius, `box-decoration-break: clone`, and `2px` bottom borders over translucent semantic washes (`rgba(21, 128, 61, 0.1)` + `#15803d` for thesis, `rgba(29, 78, 216, 0.09)` + `#1d4ed8` for explicit premise/supposition, `rgba(185, 28, 28, 0.09)` + `#b91c1c` for objection), tagged with `0.68em` bold tabular `[ID]` superscripts. Active focus or hover adds `rgba(29, 78, 216, 0.24)` wash and `2px solid #1d4ed8` outline.
- **Inference Gate Pill (`InferenceGateNode`):** `152px` wide by `44px` min-height `999px` capsule joining conjunctive premise hyperedges into a conclusion. Displays `<ID> τ=0.XX` (or `SEVERED` when `τ <= 0.05`) and the inference scheme name, shifting from `1.5px solid #1d4ed8` / `#eff6ff` when intact to `1.5px dashed #b45309` / `#fffbeb` when undercut (`>= 0.35`) or severed (`<= 0.05`).

## Do's and Don'ts

### Do:
- **Do** preserve the three-surface paper warmth hierarchy (`#f7f5f0` canvas, `#faf8f4` reading sheet, `#eeece4` apparatus rail) separated by `1px solid #d8d3c6` hairline rules.
- **Do** pair color with structural redundancy: `dashed` strokes on enthymemes and severed gates, `3px` bottom borders on active tabs, `2px` bottom rules on prose highlights, and explicit text/numeric labels.
- **Do** apply `.tabular-data` (`JetBrains Mono`, `font-variant-numeric: tabular-nums`) to every live score, slider value, latency pill, and node identifier.
- **Do** restrict `Newsreader` (`1.15rem`, `1.78` line height, `62ch` max measure) to primary philosophical passages while keeping `IBM Plex Sans` (`15px` root) on all interface controls.
- **Do** gate `180ms` to `200ms` ease-out transitions and React Flow `fitView` resize motion behind `prefers-reduced-motion`.

### Don't:
- **Don't** introduce dark sci-fi node-cockpit grounds, neon wire glows, or cold neutral gray SaaS panels that conflict with the Critical-Edition Apparatus world.
- **Don't** place box shadows on the header, reading pane, inspector rail, or Custom Lab cards at rest; reserve elevation for spatial graph nodes, floating canvas controls, and slider thumbs.
- **Don't** render implicit enthymemes or undercutting attacks with solid cobalt borders; keep them visually distinct in burnt sienna (`#b45309`) with dashed geometry.
- **Don't** omit `:focus-visible` `3px solid` outlines or rely on color alone to convey active tabs, selected text spans, or solver states.
