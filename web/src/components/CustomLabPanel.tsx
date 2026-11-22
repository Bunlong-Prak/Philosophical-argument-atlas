"use client";

import React, { useState } from "react";
import { FileCode2, Play, Sparkles } from "lucide-react";
import type {
  ArgumentHypergraph,
  EnthymemeScoreBreakdown,
  PassageDetail,
  SolverReport,
} from "@/lib/types";

interface CustomLabPanelProps {
  onLoadExtractedGraph: (
    graph: ArgumentHypergraph,
    report: SolverReport,
    argdownText?: string,
  ) => void;
}

const DEFAULT_ARGDOWN_SAMPLE = `---
passage_id: custom-syllogism
source_text: "Every person possesses moral worth that no political utility may override. Therefore forced scapegoating remains unjust even when it placates a crowd."
---

# Propositions
[P1]: Every person possesses moral worth that no political utility may override. {type: explicit_premise, credence: 0.9000, speaker: "Ethicist", span: 0..76, quote: "Every person possesses moral worth that no political utility may override."}
[E1]: Treating an innocent person merely as a social instrument violates inviolable moral worth. {type: enthymeme, credence: 0.8500, speaker: "Implicit Principle"}
[C]: Forced scapegoating remains unjust even when it placates a crowd. {type: thesis, credence: 0.0000, speaker: "Ethicist", span: 87..152, quote: "forced scapegoating remains unjust even when it placates a crowd."}

# Support Hyperedges
<H1>: [P1] & [E1] +> [C] {weight: 0.9500, scheme: modus_ponens}
`;

const NLI_PRESETS = [
  {
    name: "Descartes (Cogito)",
    premises: "Even in radical doubt, the act of thinking or doubting is occurring.",
    conclusion: "The thinker must exist as something while doubting.",
    candidates: [
      "Whatever is actively thinking must exist while it is thinking.",
      "If even in radical doubt the act of thinking or doubting is occurring, then the thinker must exist as something while doubting.",
      "The thinker necessarily exists as a substance while doubting.",
      "Sensory perceptions frequently deceive us during dreams and illusions.",
    ].join("\n"),
  },
  {
    name: "Dostoevsky (Rebellion)",
    premises:
      "Eternal cosmic harmony requires the uncompensated torture and suffering of an innocent child as a necessary means.",
    conclusion:
      "Eternal cosmic harmony is morally unworthy of acceptance at the price of an innocent child's suffering.",
    candidates: [
      "No future utilitarian good can morally justify using the unredeemed suffering of an innocent person as an instrument.",
      "If eternal cosmic harmony requires the torture of an innocent child as a necessary means, then eternal cosmic harmony is morally unworthy of acceptance at that price.",
      "Cosmic harmony purchased by innocent suffering is morally unacceptable and unworthy.",
    ].join("\n"),
  },
];

export function CustomLabPanel({ onLoadExtractedGraph }: CustomLabPanelProps) {
  // NLI Enthymeme Auditor state
  const [premisesText, setPremisesText] = useState(NLI_PRESETS[0].premises);
  const [conclusionText, setConclusionText] = useState(NLI_PRESETS[0].conclusion);
  const [candidatesText, setCandidatesText] = useState(NLI_PRESETS[0].candidates);
  const [nliResults, setNliResults] = useState<EnthymemeScoreBreakdown[]>([]);
  const [nliLoading, setNliLoading] = useState(false);
  const [nliError, setNliError] = useState<string | null>(null);

  // Graph Import state (.argdown offline solver or optional LLM extraction)
  const [graphInputMode, setGraphInputMode] = useState<"argdown" | "llm">("argdown");
  const [argdownScript, setArgdownScript] = useState(DEFAULT_ARGDOWN_SAMPLE);
  const [rawPassage, setRawPassage] = useState(
    "I think, therefore I am. Yet to assert an enduring thinking substance goes beyond immediate awareness.",
  );
  const [provider, setProvider] = useState<"groq" | "openai" | "ollama" | "anthropic">("groq");
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  async function handleScoreEnthymemes(e: React.FormEvent) {
    e.preventDefault();
    setNliError(null);
    setNliLoading(true);
    try {
      const explicit_premises = premisesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const candidates = candidatesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const resp = await fetch("/api/score-enthymemes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          explicit_premises,
          conclusion: conclusionText.trim(),
          candidates,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || "Failed to score enthymemes");
      }
      const data: EnthymemeScoreBreakdown[] = await resp.json();
      setNliResults(data);
    } catch (err) {
      setNliError(err instanceof Error ? err.message : String(err));
    } finally {
      setNliLoading(false);
    }
  }

  async function handleLoadGraph(e: React.FormEvent) {
    e.preventDefault();
    setExtractError(null);
    setExtractLoading(true);
    try {
      if (graphInputMode === "argdown") {
        const resp = await fetch("/api/parse-argdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            argdown: argdownScript,
            strict_spans: true,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: resp.statusText }));
          throw new Error(err.detail || "Failed to parse .argdown input");
        }
        const detail: PassageDetail = await resp.json();
        onLoadExtractedGraph(detail.hypergraph, detail.report, detail.argdown);
        return;
      }

      const resp = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passage_id: "custom-passage",
          source_text: rawPassage.trim(),
          provider,
          verify_enthymemes: true,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || "Extraction failed");
      }
      const data = await resp.json();
      onLoadExtractedGraph(data.hypergraph, data.solver_report, "");
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractLoading(false);
    }
  }

  return (
    <div
      style={{
        overflowY: "auto",
        blockSize: "100%",
        padding: "1.5rem",
        background: "var(--paper-canvas)",
      }}
    >
      <div
        style={{
          maxInlineSize: "1180px",
          marginInline: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "1.5rem",
          alignItems: "start",
        }}
      >
        {/* Left: DeBERTa-v3 NLI Enthymeme Auditor */}
        <section
          aria-labelledby="nli-auditor-heading"
          style={{
            background: "var(--paper-reading)",
            border: "1px solid var(--rule-hairline)",
            borderRadius: "10px",
            padding: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              marginBlockEnd: "0.75rem",
            }}
          >
            <h2 id="nli-auditor-heading" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
              DeBERTa-v3 Enthymeme Auditor
            </h2>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {NLI_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => {
                    setPremisesText(preset.premises);
                    setConclusionText(preset.conclusion);
                    setCandidatesText(preset.candidates);
                    setNliResults([]);
                  }}
                  style={{
                    minBlockSize: "30px",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid var(--rule-strong)",
                    background: "var(--paper-card)",
                    fontSize: "0.76rem",
                    fontWeight: 600,
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--ink-secondary)" }}>
            Test candidate hidden assumptions locally. The scorer rewards real entailment gain
            (&Delta;NLI) and penalizes circular restatements or trivial &ldquo;If P, then C&rdquo; tautologies.
          </p>

          <form onSubmit={handleScoreEnthymemes} style={{ display: "grid", gap: "0.8rem" }}>
            <div>
              <label
                htmlFor="nli-premises"
                style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
              >
                Explicit Premises (one per line)
              </label>
              <textarea
                id="nli-premises"
                rows={2}
                value={premisesText}
                onChange={(e) => setPremisesText(e.target.value)}
                style={{
                  inlineSize: "100%",
                  padding: "0.55rem",
                  borderRadius: "6px",
                  border: "1px solid var(--rule-strong)",
                  background: "var(--paper-card)",
                  resize: "vertical",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="nli-conclusion"
                style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
              >
                Target Conclusion
              </label>
              <input
                id="nli-conclusion"
                type="text"
                value={conclusionText}
                onChange={(e) => setConclusionText(e.target.value)}
                style={{
                  inlineSize: "100%",
                  minBlockSize: "38px",
                  padding: "0.45rem 0.55rem",
                  borderRadius: "6px",
                  border: "1px solid var(--rule-strong)",
                  background: "var(--paper-card)",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="nli-candidates"
                style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
              >
                Candidate Hidden Assumptions (one per line)
              </label>
              <textarea
                id="nli-candidates"
                rows={5}
                value={candidatesText}
                onChange={(e) => setCandidatesText(e.target.value)}
                style={{
                  inlineSize: "100%",
                  padding: "0.55rem",
                  borderRadius: "6px",
                  border: "1px solid var(--rule-strong)",
                  background: "var(--paper-card)",
                  resize: "vertical",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={nliLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.4rem",
                minBlockSize: "40px",
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--cobalt)",
                background: "var(--cobalt)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              <Play size={15} aria-hidden="true" />
              {nliLoading ? "Scoring with DeBERTa-v3..." : "Score Candidates"}
            </button>
          </form>

          {nliError && (
            <p role="alert" style={{ marginBlockStart: "0.75rem", color: "var(--crimson)", fontSize: "0.84rem" }}>
              {nliError}
            </p>
          )}

          {nliResults.length > 0 && (
            <div style={{ marginBlockStart: "1rem", display: "grid", gap: "0.55rem" }}>
              {nliResults.map((item, idx) => {
                const isValid = item.verdict === "valid_bridge";
                return (
                  <div
                    key={item.candidate}
                    style={{
                      padding: "0.7rem",
                      borderRadius: "8px",
                      border: `1px solid ${isValid ? "var(--forest-border)" : "var(--rule-hairline)"}`,
                      background: isValid ? "var(--forest-soft)" : "var(--paper-card)",
                    }}
                  >
                    <div
                      className="tabular-data"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: isValid ? "var(--forest)" : "var(--ink-secondary)",
                        marginBlockEnd: "0.25rem",
                      }}
                    >
                      <span>
                        #{idx + 1} · {item.verdict}
                      </span>
                      <span>score {item.final_score.toFixed(3)}</span>
                    </div>
                    <p style={{ margin: "0 0 0.35rem", fontSize: "0.86rem" }}>{item.candidate}</p>
                    <div className="tabular-data" style={{ fontSize: "0.73rem", color: "var(--ink-muted)" }}>
                      &Delta;NLI={item.delta_nli.toFixed(3)} · usurp={item.usurpation_score.toFixed(3)} · trivPen={item.triviality_penalty.toFixed(3)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: Offline .argdown Parser or Optional LLM Extraction */}
        <section
          aria-labelledby="llm-extractor-heading"
          style={{
            background: "var(--paper-reading)",
            border: "1px solid var(--rule-hairline)",
            borderRadius: "10px",
            padding: "1.25rem",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.5rem",
              marginBlockEnd: "0.55rem",
            }}
          >
            <h2 id="llm-extractor-heading" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
              Load Custom Argument Graph
            </h2>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                aria-pressed={graphInputMode === "argdown"}
                onClick={() => {
                  setGraphInputMode("argdown");
                  setExtractError(null);
                }}
                style={{
                  minBlockSize: "30px",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "6px",
                  border: `1px solid ${graphInputMode === "argdown" ? "var(--cobalt)" : "var(--rule-strong)"}`,
                  background: graphInputMode === "argdown" ? "var(--cobalt-soft)" : "var(--paper-card)",
                  color: graphInputMode === "argdown" ? "var(--cobalt)" : "var(--ink-secondary)",
                  fontSize: "0.76rem",
                  fontWeight: 600,
                }}
              >
                .argdown (Offline)
              </button>
              <button
                type="button"
                aria-pressed={graphInputMode === "llm"}
                onClick={() => {
                  setGraphInputMode("llm");
                  setExtractError(null);
                }}
                style={{
                  minBlockSize: "30px",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "6px",
                  border: `1px solid ${graphInputMode === "llm" ? "var(--cobalt)" : "var(--rule-strong)"}`,
                  background: graphInputMode === "llm" ? "var(--cobalt-soft)" : "var(--paper-card)",
                  color: graphInputMode === "llm" ? "var(--cobalt)" : "var(--ink-secondary)",
                  fontSize: "0.76rem",
                  fontWeight: 600,
                }}
              >
                Raw Text (LLM)
              </button>
            </div>
          </div>

          <p style={{ margin: "0 0 1rem", fontSize: "0.85rem", color: "var(--ink-secondary)" }}>
            {graphInputMode === "argdown"
              ? "Parse custom .argdown notation straight through the local Rust solver with zero API keys."
              : "Calls your chosen LLM provider, verifies quotes verbatim against the text, and opens the solved graph."}
          </p>

          <form onSubmit={handleLoadGraph} style={{ display: "grid", gap: "0.8rem" }}>
            {graphInputMode === "argdown" ? (
              <div>
                <label
                  htmlFor="custom-argdown-script"
                  style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
                >
                  Formal .argdown Specification
                </label>
                <textarea
                  id="custom-argdown-script"
                  rows={10}
                  value={argdownScript}
                  onChange={(e) => setArgdownScript(e.target.value)}
                  style={{
                    inlineSize: "100%",
                    padding: "0.55rem",
                    borderRadius: "6px",
                    border: "1px solid var(--rule-strong)",
                    background: "var(--paper-card)",
                    fontFamily: "var(--font-data)",
                    fontSize: "0.82rem",
                    lineHeight: 1.45,
                    resize: "vertical",
                  }}
                />
              </div>
            ) : (
              <>
                <div>
                  <label
                    htmlFor="llm-provider"
                    style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
                  >
                    Provider
                  </label>
                  <select
                    id="llm-provider"
                    className="atlas-select"
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as "groq" | "openai" | "ollama" | "anthropic")
                    }
                    style={{ inlineSize: "100%" }}
                  >
                    <option value="groq">Groq (requires GROQ_API_KEY)</option>
                    <option value="openai">OpenAI (requires OPENAI_API_KEY)</option>
                    <option value="anthropic">Anthropic (requires ANTHROPIC_API_KEY)</option>
                    <option value="ollama">Local Ollama (http://localhost:11434)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="llm-passage"
                    style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBlockEnd: "0.25rem" }}
                  >
                    Philosophical Passage
                  </label>
                  <textarea
                    id="llm-passage"
                    rows={6}
                    value={rawPassage}
                    onChange={(e) => setRawPassage(e.target.value)}
                    style={{
                      inlineSize: "100%",
                      padding: "0.55rem",
                      borderRadius: "6px",
                      border: "1px solid var(--rule-strong)",
                      background: "var(--paper-card)",
                      fontFamily: "var(--font-prose)",
                      fontSize: "1rem",
                      resize: "vertical",
                    }}
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={extractLoading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.4rem",
                minBlockSize: "40px",
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--cobalt)",
                background: "var(--cobalt)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              {graphInputMode === "argdown" ? (
                <FileCode2 size={15} aria-hidden="true" />
              ) : (
                <Sparkles size={15} aria-hidden="true" />
              )}
              {extractLoading
                ? "Solving..."
                : graphInputMode === "argdown"
                  ? "Parse & Open in Workbench"
                  : "Extract & Open in Workbench"}
            </button>
          </form>

          {extractError && (
            <div
              role="alert"
              style={{
                marginBlockStart: "0.85rem",
                padding: "0.7rem",
                borderRadius: "6px",
                border: "1px solid var(--crimson-border)",
                background: "var(--crimson-soft)",
                color: "var(--crimson)",
                fontSize: "0.83rem",
              }}
            >
              {extractError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
