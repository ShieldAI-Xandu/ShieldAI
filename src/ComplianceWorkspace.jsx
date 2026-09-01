// src/ComplianceWorkspace.jsx
// The client-facing compliance workspace — the frontend half of the deep
// framework engine.
//
// WHY THIS FILE EXISTS
// --------------------
// The backend had 11 control-mapped frameworks and 624 computed controls. The
// frontend rendered `results.compliance.frameworks` — the AI-generated program
// text — and called exactly two endpoints in the whole app (login, register).
// So a client read AI prose about ISO 27001 while a 93-control computed
// assessment with citations sat unused on the server.
//
// This closes that. Everything here reads from the deterministic engine:
//
//   GET  /api/compliance/overview            every framework, computed
//   GET  /api/compliance/framework/:id       control-by-control walkthrough
//   GET  /api/compliance/intake/:id          scoping questionnaire
//   POST /api/compliance/intake/:id          save scoping -> re-scope
//   GET  /api/compliance/conflicts           agent vs questionnaire
//   POST /api/compliance/conflicts/resolve   the client's decision
//   POST /api/compliance/answer              update one control answer
//
// THREE RULES THIS UI MUST NOT BREAK
// -----------------------------------
// 1. null is not zero. `compliancePct: null` means "not assessed yet" and must
//    render as "—", never "0%". A client who hasn't answered has not failed.
// 2. Both sources show, the questionnaire decides. Where the agent disagrees,
//    both values appear on the control with a decision the client makes. The
//    UI never picks a side.
// 3. Depth is labelled. AI-assisted frameworks say so, in the UI, next to
//    their name.

import React, { useState, useEffect, useCallback } from "react";

// Defensive rendering guard. Every value here ultimately comes from the
// backend — most of it deterministic (framework definitions, computed
// control status), but some genuinely AI-generated (the remediation-guidance
// feature below). Either way, if a field ever comes back as an object where
// a string was expected, rendering it directly as a JSX child throws
// "Objects are not valid as a React child" (React error #31) and takes down
// this whole workspace. safeText() prevents that unconditionally.
function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object") {
    console.warn("safeText: expected a string but got an object — coercing.", value);
    if (Array.isArray(value)) {
      const joined = value.map(v => safeText(v, "")).filter(Boolean).join(", ");
      return joined || fallback;
    }
    const firstString = Object.values(value).find(v => typeof v === "string");
    if (firstString) return firstString;
    return fallback;
  }
  return String(value);
}

const C = {
  bg: "#080D18", surface: "#0D1526", card: "#101C30", cardHov: "#142035",
  border: "#1A2D47", borderHi: "#254060", accent: "#00C8FF", accentDm: "#0090BB",
  green: "#00E5A0", amber: "#FFB800", red: "#FF4D6A", purple: "#A855F7",
  text: "#E2EDFF", textSec: "#7B92B2", textMut: "#2E4A6A",
};

const STATUS_COLOR = {
  compliant: C.green, partial: C.amber, gap: C.red, unknown: C.textMut,
};
const STATUS_LABEL = {
  compliant: "Met", partial: "Partial", gap: "Gap", unknown: "Not assessed",
};

// Rule 1, enforced in one place: null means "we haven't asked", not "you failed".
const pct = (v) => (v === null || v === undefined ? "—" : `${v}%`);

function Pill({ text, color, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3,
      background: `${color}1A`, color, border: `1px solid ${color}44`,
    }}>{text}</span>
  );
}

function DepthBadge({ depth }) {
  if (depth === "control-mapped") {
    return <Pill text="CONTROL-MAPPED" color={C.green}
      title="Every control is enumerated in our engine, cited to its source, and mapped to your answers. Findings are computed and traceable — not written by an AI." />;
  }
  if (depth === "ai-assisted") {
    return <Pill text="AI-ASSISTED" color={C.amber}
      title="A contextual gap analysis generated from your business profile. Useful for orientation, but it's the AI's interpretation rather than a control-level assessment." />;
  }
  return <Pill text="PLANNED" color={C.textMut} title="On the roadmap. Not yet available." />;
}

// ── Overview: every framework, computed ───────────────────────
export function ComplianceOverview({ authFetch, apiBase, clientId, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  useEffect(() => {
    let live = true;
    authFetch(`${apiBase}/api/compliance/overview${q}`)
      .then(r => r.json())
      .then(d => { if (live) setData(d); })
      .catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [apiBase, clientId]);

  if (err) return <Note tone="red">Couldn't load compliance: {safeText(err)}</Note>;
  if (!data) return <Note>Loading…</Note>;
  if (!data.hasAssessment) {
    return <Note>{safeText(data.note) || "No assessment on file. Compliance can't be determined without answers."}</Note>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Compliance</h3>
        {data.posture && (
          <span style={{ color: C.textSec, fontSize: 12.5 }}>
            Posture {data.posture.score} · {data.posture.level}
          </span>
        )}
      </div>
      <p style={{ color: C.textSec, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 16px" }}>
        Computed from your assessment answers, control by control. Percentages are over
        controls we've actually assessed — a dash means we haven't asked yet, not that you failed.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        {data.frameworks.map(f => (
          <div key={f.id} onClick={() => onOpen && onOpen(f.id)}
            style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "14px 16px", cursor: onOpen ? "pointer" : "default",
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{safeText(f.short) || safeText(f.name)}</span>
              <DepthBadge depth={f.depth} />
              <span style={{ marginLeft: "auto", color: C.textSec, fontSize: 12 }}>
                {f.notControlMapped ? "Gap analysis" : `${f.assessed ?? 0} of ${f.total} assessed`}
              </span>
            </div>

            {f.notControlMapped ? (
              <div style={{ color: C.textMut, fontSize: 11.5 }}>
                No control-level walkthrough for this framework — we won't fake one.
              </div>
            ) : f.pctSuppressedReason ? (
              // A percentage was deliberately withheld. Say why — a bare dash
              // looks like a loading state or a bug, and this is neither.
              <div style={{ color: C.textSec, fontSize: 11.5, lineHeight: 1.6 }}>
                {safeText(f.pctSuppressedReason)}
              </div>
            ) : (
              <>
                <div style={{ height: 6, background: C.surface, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{
                    width: `${f.readinessPct ?? 0}%`, height: "100%",
                    background: `linear-gradient(90deg, ${C.accent}, ${C.green})`,
                  }} />
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: C.textSec }}>
                  <span style={{ color: C.green }}>{f.compliant} met</span>
                  <span style={{ color: C.amber }}>{f.partial} partial</span>
                  <span style={{ color: C.red }}>{f.gap} gaps</span>
                  {f.unknown > 0 && <span style={{ color: C.textMut }}>{f.unknown} not assessed</span>}
                  <span style={{ marginLeft: "auto" }}>Readiness {pct(f.readinessPct)}</span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

// One outcome of clicking "Choose this" — the explicit answer to "did that
// work?" rather than making the client infer it from a card disappearing.
function ResolutionFeedback({ f, onDismiss }) {
  const tone = !f.ok ? C.red : f.stillDisputed ? C.amber : C.green;
  const heading = !f.ok
    ? "Couldn't save that decision"
    : f.stillDisputed
    ? "Recorded — but still open"
    : "Resolved";

  return (
    <div style={{
      background: `${tone}0D`, border: `1px solid ${tone}44`, borderRadius: 10,
      padding: "12px 14px", marginBottom: 10, position: "relative",
    }}>
      <button onClick={onDismiss} title="Dismiss" style={{
        position: "absolute", top: 8, right: 10, background: "none", border: "none",
        color: C.textMut, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 4,
      }}>×</button>
      <div style={{ color: tone, fontSize: 12.5, fontWeight: 700, marginBottom: 3, paddingRight: 20 }}>
        {heading} · {safeText(f.decisionLabel)}
      </div>
      <div style={{ color: C.textSec, fontSize: 11.5, marginBottom: 4 }}>{safeText(f.question)}</div>

      {!f.ok && (
        <div style={{ color: C.text, fontSize: 12 }}>{safeText(f.error) || "Something went wrong — try again."}</div>
      )}

      {f.ok && (
        <div style={{ color: C.text, fontSize: 12, lineHeight: 1.6 }}>
          {safeText(f.note) || safeText(f.effect)}
        </div>
      )}

      {f.ok && f.posture && f.posture.delta !== 0 && (
        <div style={{ color: C.textSec, fontSize: 11.5, marginTop: 4 }}>
          Posture score {f.posture.before} → {f.posture.after} ({f.posture.delta > 0 ? "+" : ""}{f.posture.delta})
        </div>
      )}

      {f.ok && f.stillDisputed && f.remediation && (
        <div style={{ marginTop: 8, background: C.surface, borderRadius: 8, padding: "9px 11px" }}>
          <div style={{ color: C.text, fontSize: 11.5, lineHeight: 1.6, marginBottom: f.remediation.failingHosts?.length ? 6 : 0 }}>
            {safeText(f.remediation.recommendation)}
          </div>
          {f.remediation.failingHosts?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {f.remediation.failingHosts.map((h, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 4,
                  background: `${C.red}1A`, color: C.red,
                }}>{safeText(h)}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── The conflict queue ────────────────────────────────────────
// Where the agent and the questionnaire disagree. This is the decision point:
// both values shown, three options, nothing auto-resolved.
export function ConflictQueue({ authFetch, apiBase, clientId, onResolved }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reason, setReason] = useState({});
  const [newAnswer, setNewAnswer] = useState({});
  // Per-control gate in front of "update-answer": undefined = not yet chosen,
  // "yes" = agrees with the agent (narrowed to just the agent-consistent
  // answers, or applied immediately if there's only one), "no" = wants the
  // full answer list instead.
  const [agreeChoice, setAgreeChoice] = useState({});
  const [feedback, setFeedback] = useState([]);
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  const load = useCallback(() => {
    authFetch(`${apiBase}/api/compliance/conflicts${q}`)
      .then(r => r.json()).then(setData).catch(() => setData({ conflicts: [] }));
  }, [apiBase, clientId]);
  useEffect(load, [load]);

  async function resolve(c, decision, answerOverride) {
    // answerOverride lets the one-click "Yes, matches the agent" path submit
    // immediately when there's exactly one agent-consistent answer, without
    // waiting on a setState-then-click round-trip through the newAnswer state.
    const answerToUse = answerOverride !== undefined ? answerOverride : newAnswer[c.controlId];
    if (decision === "out-of-scope" && !String(reason[c.controlId] || "").trim()) return;
    if (decision === "update-answer" && !answerToUse) return;
    setBusy(c.controlId + decision);
    const decisionLabel = c.resolution?.options?.find(o => o.id === decision)?.label || decision;
    try {
      const res = await authFetch(`${apiBase}/api/compliance/conflicts/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: c.controlId, decision, clientId,
          reason: reason[c.controlId], newAnswer: answerToUse,
        }),
      });
      const d = await res.json().catch(() => ({}));
      const entry = { fbId: `${c.controlId}-${decision}-${Date.now()}`, ok: res.ok, question: c.question, decisionLabel, ...d };
      setFeedback(fb => [entry, ...fb].slice(0, 8));
      if (res.ok) {
        setAgreeChoice(s => { const n = { ...s }; delete n[c.controlId]; return n; });
        load(); onResolved && onResolved();
      }
    } finally { setBusy(null); }
  }

  function dismissFeedback(fbId) {
    setFeedback(fb => fb.filter(f => f.fbId !== fbId));
  }

  const feedbackNode = feedback.length > 0 && (
    <div style={{ marginBottom: 14 }}>
      {feedback.map(f => <ResolutionFeedback key={f.fbId} f={f} onDismiss={() => dismissFeedback(f.fbId)} />)}
    </div>
  );

  if (!data) return null;
  if (!data.reportingHosts) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6 }}>{safeText(data.note)}</div>
      </div>
    );
  }
  if (!data.conflicts?.length) {
    return (
      <div style={{ marginBottom: 16 }}>
        {feedbackNode}
        <div style={{ background: `${C.green}0D`, border: `1px solid ${C.green}33`, borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: C.green, fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            Agent and answers agree
          </div>
          <div style={{ color: C.textSec, fontSize: 11.5 }}>
            {data.confirmed?.length || 0} control(s) independently confirmed across {data.reportingHosts} host(s).
            That's measured evidence — worth showing an auditor.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: C.amber, fontSize: 13.5, fontWeight: 700 }}>
          {data.conflicts.length} conflict{data.conflicts.length > 1 ? "s" : ""} need your decision
        </span>
        <Pill text={`${data.reportingHosts} HOSTS REPORTING`} color={C.textSec} />
      </div>
      <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>
        Your answers and what the agent measured disagree. We won't pick a side — the agent only sees
        endpoints, and you know your environment. {safeText(data.boundary)}
      </p>

      {feedbackNode}

      {data.conflicts.map(c => (
        <div key={c.controlId} style={{
          background: C.card, border: `1px solid ${C.amber}44`, borderRadius: 10,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <div style={{ color: C.text, fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{safeText(c.question)}</div>

          {/* Both sources, side by side. Rule 2. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 0.6, marginBottom: 4 }}>
                YOU SAID · DECIDES
              </div>
              <div style={{ color: C.text, fontSize: 12.5 }}>{safeText(c.yourAnswer)}</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, letterSpacing: 0.6, marginBottom: 4 }}>
                AGENT MEASURED · INFORMS
              </div>
              <div style={{ color: C.text, fontSize: 12.5 }}>{safeText(c.agentObserved.summary)}</div>
              {c.agentObserved.perHost?.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.agentObserved.perHost.map((h, i) => (
                    <span key={i} style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 4,
                      background: h.status === "pass" ? `${C.green}1A` : `${C.red}1A`,
                      color: h.status === "pass" ? C.green : C.red,
                    }}>{safeText(h.host)}: {safeText(h.observed)}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
            The agent can see: {safeText(c.agentObserved.whatItSees)} — but not: {safeText(c.agentObserved.whatItCannotSee)}
          </div>

          {/* What's actually at stake, and what happens if this is left alone. */}
          {(c.resolution?.whyThisMatters || c.resolution?.unresolvedMeaning) && (
            <div style={{ color: C.textSec, fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
              {c.resolution?.whyThisMatters && <div>{safeText(c.resolution.whyThisMatters)}</div>}
              {c.resolution?.unresolvedMeaning && (
                <div style={{ marginTop: 2 }}>{safeText(c.resolution.unresolvedMeaning)}</div>
              )}
            </div>
          )}

          {c.previouslyResolved && (
            <div style={{ background: `${C.amber}0D`, borderRadius: 6, padding: "8px 10px", marginBottom: 10 }}>
              <div style={{ color: C.amber, fontSize: 11, fontWeight: 700, marginBottom: 2 }}>
                Still open — you already decided this
              </div>
              <div style={{ color: C.text, fontSize: 11, lineHeight: 1.5 }}>
                You chose "{safeText(c.previouslyResolved.decisionLabel)}"
                {c.previouslyResolved.resolvedAt && <> on {fmtWhen(c.previouslyResolved.resolvedAt)}</>}.
                {c.previouslyResolved.reason && <> Reason given: "{safeText(c.previouslyResolved.reason)}".</>}
                {" "}The agent's telemetry still disagrees, so it stays on this list — that's expected for
                "my answer is the goal" and "out of scope" choices, and only clears once the failing host(s)
                report back clean.
              </div>
            </div>
          )}

          {/* The decision. Rule 2: the client chooses. */}
          <div style={{ display: "grid", gap: 8 }}>
            {c.resolution.options.map(o => {
              if (o.id === "update-answer") {
                const suggested = c.resolution.agentSuggestedAnswers || [];
                const choice = agreeChoice[c.controlId];
                return (
                  <UpdateAnswerOption key={o.id} o={o} c={c} suggested={suggested} choice={choice}
                    newAnswer={newAnswer[c.controlId] || ""}
                    setChoice={(v) => setAgreeChoice(s => ({ ...s, [c.controlId]: v }))}
                    setAnswer={(v) => setNewAnswer(s => ({ ...s, [c.controlId]: v }))}
                    busy={busy === c.controlId + o.id}
                    onSubmit={(answer) => resolve(c, o.id, answer)} />
                );
              }
              return (
                <div key={o.id} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ color: C.text, fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{safeText(o.label)}</div>
                  <div style={{ color: C.textSec, fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>{safeText(o.effect)}</div>

                  {o.requiresReason && (
                    <input value={reason[c.controlId] || ""} onChange={e => setReason(s => ({ ...s, [c.controlId]: e.target.value }))}
                      placeholder="Why aren't these hosts representative? An auditor will read this."
                      style={{
                        width: "100%", marginBottom: 8, padding: "6px 8px", borderRadius: 6,
                        background: C.bg, color: C.text, border: `1px solid ${C.border}`, fontSize: 12,
                      }} />
                  )}

                  <button onClick={() => resolve(c, o.id)} disabled={busy === c.controlId + o.id}
                    style={{
                      padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                      fontSize: 11.5, fontWeight: 700, color: C.bg,
                      background: `linear-gradient(135deg, ${C.accent}, ${C.accentDm})`,
                    }}>
                    {busy === c.controlId + o.id ? "Saving…" : "Choose this"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// The "update-answer" resolution option specifically: a Yes/No gate in front
// of picking an answer, rather than an open-ended dropdown up front.
//   Yes -> agrees with what the agent measured. If only one answer is
//          consistent with that verdict, applies it immediately (one click —
//          nothing to pick, since there's nothing ambiguous about it). If
//          more than one is consistent (e.g. disk encryption's "fail" bucket
//          covers both "Some systems only" and "No / not sure" — genuinely
//          different real-world states), narrows the dropdown to just those
//          instead of guessing which one.
//   No  -> wants a different answer than what the agent implies. Shows the
//          full list, same as before this was added.
function UpdateAnswerOption({ o, c, suggested, choice, newAnswer, setChoice, setAnswer, busy, onSubmit }) {
  const selectStyle = {
    width: "100%", marginBottom: 8, padding: "6px 8px", borderRadius: 6,
    background: C.bg, color: C.text, border: `1px solid ${C.border}`, fontSize: 12,
  };
  const buttonStyle = {
    padding: "6px 12px", borderRadius: 6, border: "none", cursor: busy ? "wait" : "pointer",
    fontSize: 11.5, fontWeight: 700, color: C.bg,
    background: `linear-gradient(135deg, ${C.accent}, ${C.accentDm})`,
  };
  const backLink = (
    <button onClick={() => { setChoice(undefined); setAnswer(""); }} disabled={busy}
      style={{ background: "none", border: "none", color: C.textMut, fontSize: 11, cursor: "pointer", padding: 0, marginLeft: 10 }}>
      ← back
    </button>
  );

  return (
    <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ color: C.text, fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{safeText(o.label)}</div>
      <div style={{ color: C.textSec, fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>{safeText(o.effect)}</div>

      {choice === undefined ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.textSec, fontSize: 11.5, marginRight: 2 }}>Update your answer to match?</span>
          <button
            onClick={() => (suggested.length === 1 ? onSubmit(suggested[0]) : setChoice("yes"))}
            disabled={busy} style={{ ...buttonStyle, padding: "5px 14px" }}>
            {busy ? "Saving…" : "Yes"}
          </button>
          <button onClick={() => setChoice("no")} disabled={busy}
            style={{
              padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 700,
              color: C.textSec, background: "transparent", border: `1px solid ${C.border}`,
            }}>
            No
          </button>
        </div>
      ) : (
        <>
          <select value={newAnswer} onChange={e => setAnswer(e.target.value)} style={selectStyle}>
            <option value="">
              {choice === "yes" ? "Choose which matches reality…" : "Choose the answer that matches reality…"}
            </option>
            {(choice === "yes" ? suggested : (c.validAnswers || [])).map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={() => onSubmit(newAnswer)} disabled={busy || !newAnswer} style={buttonStyle}>
            {busy ? "Saving…" : "Choose this"}
          </button>
          {backLink}
        </>
      )}
    </div>
  );
}

// ── Scoping intake ────────────────────────────────────────────
export function FrameworkIntake({ authFetch, apiBase, frameworkId, clientId, onSaved }) {
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  useEffect(() => {
    authFetch(`${apiBase}/api/compliance/intake/${frameworkId}${q}`)
      .then(r => r.json()).then(d => { setData(d); setAnswers(d.answers || {}); })
      .catch(() => setData({ hasIntake: false }));
  }, [apiBase, frameworkId, clientId]);

  async function save() {
    setSaving(true);
    try {
      const res = await authFetch(`${apiBase}/api/compliance/intake/${frameworkId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, clientId }),
      });
      const d = await res.json();
      setResult(d);
      setData(s => ({ ...s, questions: d.questions, status: d.status }));
      onSaved && onSaved();
    } finally { setSaving(false); }
  }

  if (!data || !data.hasIntake) return null;

  // A "multi" question (currently: SOC 2's trust-services categories) stores
  // an array of values, not one. Locked options (e.g. "Security", mandatory)
  // are always included and can't be toggled off.
  function multiValue(qq, current) {
    return Array.isArray(current) ? current : qq.options.filter(o => o.locked).map(o => o.value);
  }
  function toggleMulti(qq, o) {
    if (o.locked) return;
    setAnswers(s => {
      const cur = multiValue(qq, s[qq.id]);
      const next = cur.includes(o.value) ? cur.filter(v => v !== o.value) : [...cur, o.value];
      return { ...s, [qq.id]: next };
    });
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ color: C.text, fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{safeText(data.title)}</div>
      <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>{safeText(data.why)}</p>

      {data.questions.map(qq => {
        const isMulti = qq.type === "multi";
        return (
        <div key={qq.id} style={{ marginBottom: 12 }}>
          <div style={{ color: C.text, fontSize: 12.5, marginBottom: 4 }}>{safeText(qq.question)}</div>
          {qq.help && <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 6 }}>{safeText(qq.help)}</div>}
          {qq.note && <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 6 }}>{safeText(qq.note)}</div>}
          <div style={{ display: "grid", gap: 5 }}>
            {qq.options.map((o, i) => {
              const sel = isMulti
                ? multiValue(qq, answers[qq.id]).includes(o.value)
                : JSON.stringify(answers[qq.id]) === JSON.stringify(o.value);
              return (
                <button key={i} disabled={o.locked}
                  onClick={() => isMulti ? toggleMulti(qq, o) : setAnswers(s => ({ ...s, [qq.id]: o.value }))}
                  style={{
                    textAlign: "left", padding: "7px 10px", borderRadius: 6, fontSize: 12,
                    cursor: o.locked ? "default" : "pointer",
                    background: sel ? `${C.accent}1A` : C.surface,
                    color: sel ? C.accent : C.textSec,
                    border: `1px solid ${sel ? C.accent + "66" : C.border}`,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                  {isMulti && (
                    <span style={{
                      width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                      border: `1.5px solid ${sel ? C.accent : C.textMut}`,
                      background: sel ? C.accent : "transparent",
                    }} />
                  )}
                  {safeText(o.label)}
                  {o.locked && <span style={{ marginLeft: "auto", color: C.textMut, fontSize: 10 }}>locked</span>}
                </button>
              );
            })}
          </div>
        </div>
        );
      })}

      {data.status && !data.status.complete && (
        <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
          If you skip this: {safeText(data.status.defaultIfSkipped)}
        </div>
      )}

      <button onClick={save} disabled={saving}
        style={{
          padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer",
          fontSize: 12, fontWeight: 700, color: C.bg,
          background: `linear-gradient(135deg, ${C.accent}, ${C.accentDm})`,
        }}>{saving ? "Saving…" : "Save scoping"}</button>

      {/* The payoff, made visible. */}
      {result?.scopeChange && result.scopeChange.scoped !== result.scopeChange.unscoped && (
        <div style={{ marginTop: 12, background: `${C.green}0D`, border: `1px solid ${C.green}33`, borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ color: C.green, fontSize: 12, fontWeight: 700, marginBottom: 3 }}>
            Scope narrowed: {result.scopeChange.unscoped} → {result.scopeChange.scoped} controls
          </div>
          <div style={{ color: C.textSec, fontSize: 11, lineHeight: 1.5 }}>
            {result.scopeChange.excluded > 0 && `${result.scopeChange.excluded} scoped out with a recorded reason. `}
            {safeText(result.suggestionNote)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Control-by-control walkthrough ────────────────────────────
export function FrameworkDetail({ authFetch, apiBase, frameworkId, clientId, onBack }) {
  const [data, setData] = useState(null);
  const [section, setSection] = useState(null);
  const [filter, setFilter] = useState("all");
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  const load = useCallback(() => {
    authFetch(`${apiBase}/api/compliance/framework/${frameworkId}${q}`)
      .then(r => r.json()).then(setData).catch(() => setData(null));
  }, [apiBase, frameworkId, clientId]);
  useEffect(load, [load]);

  if (!data) return <Note>Loading…</Note>;
  if (!data.hasAssessment) return <Note>{safeText(data.note)}</Note>;

  const reqs = (data.requirements || []).filter(r => {
    if (filter !== "all" && r.status !== filter) return false;
    if (section && r.section !== section) return false;
    return true;
  });

  return (
    <div>
      {onBack && (
        <button onClick={onBack} style={{
          background: "none", border: "none", color: C.accent, cursor: "pointer",
          fontSize: 12, padding: 0, marginBottom: 10,
        }}>← All frameworks</button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>{safeText(data.framework.name)}</h3>
        <DepthBadge depth={data.depth} />
      </div>
      {data.framework.citation && (
        <div style={{ color: C.textMut, fontSize: 11, marginBottom: 8 }}>{safeText(data.framework.citation)}</div>
      )}
      {data.framework.note && (
        <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 10px" }}>{safeText(data.framework.note)}</p>
      )}

      {data.notControlMapped ? (
        <Note tone="amber">{safeText(data.why)}</Note>
      ) : (
        <>
          <FrameworkIntake authFetch={authFetch} apiBase={apiBase} frameworkId={frameworkId}
            clientId={clientId} onSaved={load} />

          {data.agent && data.openDecisions?.length > 0 && (
            <Note tone="amber">
              {data.openDecisions.length} of these controls have a conflict between your answers and what
              the agent measured. Resolve them in the Conflicts view — one decision can settle several controls.
            </Note>
          )}

          {/* Filters */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
            {["all", "compliant", "partial", "gap", "unknown"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: "4px 10px", borderRadius: 999, fontSize: 11, cursor: "pointer",
                  border: `1px solid ${filter === f ? C.accent : C.border}`,
                  background: filter === f ? `${C.accent}1A` : "transparent",
                  color: filter === f ? C.accent : C.textSec,
                }}>
                {f === "all" ? `All ${data.summary.total}` : `${STATUS_LABEL[f]} ${data.summary[f === "compliant" ? "compliant" : f]}`}
              </button>
            ))}
            {data.sectionNames?.length > 1 && (
              <select value={section || ""} onChange={e => setSection(e.target.value || null)}
                style={{
                  marginLeft: "auto", padding: "4px 8px", borderRadius: 6, fontSize: 11,
                  background: C.surface, color: C.textSec, border: `1px solid ${C.border}`,
                }}>
                <option value="">All sections</option>
                {data.sectionNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>

          {data.excludedCount > 0 && (
            <details style={{ marginBottom: 12 }}>
              <summary style={{ color: C.textSec, fontSize: 12, cursor: "pointer" }}>
                {data.excludedCount} control(s) scoped out — an auditor will ask why
              </summary>
              <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
                {data.excluded.map(e => (
                  <div key={e.id} style={{ background: C.surface, borderRadius: 6, padding: "7px 10px" }}>
                    <span style={{ color: C.textSec, fontSize: 11.5, fontWeight: 700 }}>{safeText(e.id)}</span>
                    <span style={{ color: C.textMut, fontSize: 11, marginLeft: 8 }}>{safeText(e.reason)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            {reqs.map(r => (
              <RequirementRow key={r.id} r={r} frameworkId={frameworkId} authFetch={authFetch} apiBase={apiBase}
                clientId={clientId} onSaved={load} />
            ))}
          </div>

          {data.detail?.disclaimer && (
            <div style={{ marginTop: 16, color: C.textMut, fontSize: 11, lineHeight: 1.6 }}>
              {safeText(data.detail.disclaimer)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Read a File into { filename, mimeType, content } (raw base64) — the shape
// POST /api/evidence expects. Mirrors App.jsx's fileToUpload; inlined here so
// this module stays self-contained.
function readFileAsUpload(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf(",");
      resolve({ filename: file.name, mimeType: file.type, content: i >= 0 ? s.slice(i + 1) : s });
    };
    fr.onerror = () => reject(new Error("Could not read the file."));
    fr.readAsDataURL(file);
  });
}
const REMEDIATION_EVIDENCE_MAX = 3.5 * 1024 * 1024;

// "Mark remediated": records that the client fixed a framework gap. Moves the
// underlying answer(s) to their target so the score updates now, but the
// requirement is badged "pending verification" until an analyst signs off — and
// a file is required before they can. The facts (which answers move, to what)
// are computed server-side; this only collects the note and the evidence.
function RemediationAttest({ r, frameworkId, authFetch, apiBase, clientId, onSaved }) {
  const existing = r.remediation;
  const [openForm, setOpenForm] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { text, tone }

  if (existing && existing.status !== "rejected") {
    const verified = existing.status === "verified";
    return (
      <div style={{
        marginTop: 8, padding: "9px 11px", background: C.surface, borderRadius: 6,
        border: `1px solid ${verified ? C.green + "55" : C.amber + "55"}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: existing.note ? 4 : 0 }}>
          <Pill
            text={verified ? "REMEDIATION VERIFIED" : "ATTESTED · PENDING VERIFICATION"}
            color={verified ? C.green : C.amber} />
          <span style={{ color: C.textMut, fontSize: 10.5 }}>
            {verified
              ? `Verified ${new Date(existing.verifiedAt).toLocaleDateString()}`
              : `Marked ${new Date(existing.attestedAt).toLocaleDateString()}`}
          </span>
        </div>
        {existing.note && (
          <div style={{ color: C.textSec, fontSize: 11.5, lineHeight: 1.5 }}>{safeText(existing.note)}</div>
        )}
        {existing.status === "pending" && !existing.evidenceId && (
          <div style={{ color: C.textMut, fontSize: 10.5, marginTop: 4 }}>
            Attach evidence so your analyst can verify this.
          </div>
        )}
      </div>
    );
  }

  if (r.status !== "gap" && r.status !== "partial") return null;

  async function submit() {
    if (busy) return;
    if (!note.trim()) { setMsg({ text: "Describe what you changed.", tone: C.red }); return; }
    setBusy(true); setMsg(null);
    try {
      let evidenceId = null;
      if (file) {
        if (file.size > REMEDIATION_EVIDENCE_MAX) throw new Error("File is over the 3.5MB limit.");
        const up = await readFileAsUpload(file);
        const evRes = await authFetch(`${apiBase}/api/evidence`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "control", refId: `${frameworkId}:${r.id}`,
            title: `Remediation evidence: ${r.name}`.slice(0, 160),
            note: note.trim(),
            ...(clientId ? { ownerUserId: clientId } : {}),
            ...up,
          }),
        });
        const evData = await evRes.json();
        if (!evRes.ok) throw new Error(evData.error || "Could not upload evidence.");
        evidenceId = evData.id;
      }
      const res = await authFetch(`${apiBase}/api/compliance/remediate/attest`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameworkId, requirementId: r.id, note: note.trim(), evidenceId, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record that.");
      const delta = data.posture?.delta;
      setMsg({
        text: `Recorded — pending verification.${delta ? ` Posture ${delta > 0 ? "+" : ""}${delta}.` : ""}${
          data.alsoAffects ? ` Also satisfied ${data.alsoAffects} related requirement(s).` : ""
        }`,
        tone: C.green,
      });
      setOpenForm(false); setNote(""); setFile(null);
      onSaved?.();
    } catch (e) {
      setMsg({ text: e.message, tone: C.red });
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {!openForm ? (
        <button onClick={() => setOpenForm(true)} style={{
          background: "transparent", border: `1px solid ${C.border}`, color: C.accent,
          fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "5px 10px", cursor: "pointer",
        }}>Mark remediated</button>
      ) : (
        <div style={{ background: C.surface, borderRadius: 6, padding: "10px 11px", border: `1px solid ${C.border}` }}>
          <div style={{ color: C.textSec, fontSize: 11, marginBottom: 6, lineHeight: 1.5 }}>
            Moves the failing answer(s) to their target now. Your analyst verifies it —
            a file is required before they can.
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            placeholder="What did you change? (required)" rows={3} style={{
              width: "100%", boxSizing: "border-box", background: C.card, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 11.5, padding: "6px 8px", resize: "vertical",
            }} />
          <input type="file" onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ color: C.textSec, fontSize: 11, marginTop: 6, display: "block" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={submit} disabled={busy} style={{
              background: C.accent, border: "none", color: "#03121A", fontSize: 11, fontWeight: 700,
              borderRadius: 6, padding: "5px 12px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}>{busy ? "Saving…" : "Submit"}</button>
            <button onClick={() => { setOpenForm(false); setMsg(null); }} style={{
              background: "transparent", border: `1px solid ${C.border}`, color: C.textSec,
              fontSize: 11, borderRadius: 6, padding: "5px 12px", cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div style={{ color: msg.tone, fontSize: 11, marginTop: 6 }}>{safeText(msg.text)}</div>}
    </div>
  );
}

// Staff-side queue: the client's remediation attestations awaiting a verify or
// reject decision. Rendered in the analyst client-detail view.
export function RemediationVerifyQueue({ authFetch, apiBase, clientId }) {
  const [list, setList] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const load = useCallback(() => {
    authFetch(`${apiBase}/api/compliance/remediations${q}`)
      .then(r => r.json())
      .then(d => setList(Array.isArray(d) ? d : []))
      .catch(() => setList([]));
  }, [apiBase, q, authFetch]);
  useEffect(() => { load(); }, [load]);

  async function act(rec, kind) {
    let reason = null;
    if (kind === "reject") {
      reason = window.prompt("Why are you rejecting this remediation? The client will see it.");
      if (reason == null || !reason.trim()) return;
    }
    setBusyId(rec.id); setMsg(null);
    try {
      const res = await authFetch(`${apiBase}/api/compliance/remediation/${rec.id}/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "reject" ? { reason: reason.trim() } : {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Action failed.");
      setMsg({ text: kind === "verify" ? "Verified." : "Rejected — answers reverted.", tone: C.green });
      load();
    } catch (e) {
      setMsg({ text: e.message, tone: C.red });
    } finally { setBusyId(null); }
  }

  if (!list) return null;
  const pending = list.filter(r => r.status === "pending");
  if (!pending.length) {
    return <div style={{ color: C.textSec, fontSize: 12 }}>No remediations awaiting verification.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pending.map(rec => (
        <div key={rec.id} style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: "10px 12px" }}>
          <div style={{ color: C.text, fontSize: 12.5, fontWeight: 600 }}>
            {safeText(rec.frameworkId)} · {safeText(rec.requirementName)}
          </div>
          <div style={{ color: C.textSec, fontSize: 11.5, margin: "4px 0", lineHeight: 1.5 }}>{safeText(rec.note)}</div>
          <div style={{ color: C.textMut, fontSize: 10.5 }}>
            Marked {new Date(rec.attestedAt).toLocaleDateString()} ·{" "}
            {rec.evidenceId ? "evidence attached" : "no evidence — cannot verify"}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => act(rec, "verify")} disabled={busyId === rec.id || !rec.evidenceId} style={{
              background: rec.evidenceId ? C.green : C.border, border: "none", color: "#03121A",
              fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "5px 12px",
              cursor: (busyId === rec.id || !rec.evidenceId) ? "default" : "pointer",
              opacity: (busyId === rec.id || !rec.evidenceId) ? 0.6 : 1,
            }}>Verify</button>
            <button onClick={() => act(rec, "reject")} disabled={busyId === rec.id} style={{
              background: "transparent", border: `1px solid ${C.red}66`, color: C.red,
              fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "5px 12px",
              cursor: busyId === rec.id ? "default" : "pointer",
            }}>Reject</button>
          </div>
        </div>
      ))}
      {msg && <div style={{ color: msg.tone, fontSize: 11 }}>{safeText(msg.text)}</div>}
    </div>
  );
}

function RequirementRow({ r, frameworkId, authFetch, apiBase, clientId, onSaved }) {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLOR[r.status];
  return (
    <div style={{
      background: C.card, borderRadius: 8,
      border: `1px solid ${r.hasDispute ? C.amber + "66" : C.border}`,
    }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer" }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span style={{ color: C.textSec, fontSize: 11.5, fontFamily: "monospace", minWidth: 62 }}>{safeText(r.id)}</span>
        <span style={{ color: C.text, fontSize: 12.5, flex: 1 }}>{safeText(r.name)}</span>
        {r.hasCorroboration && <Pill text="AGENT-CONFIRMED" color={C.green} title="Independently confirmed by the monitoring agent — measured evidence, not a self-assessment." />}
        {r.hasDispute && <Pill text="CONFLICT" color={C.amber} title="Your answer and the agent's measurement disagree. Needs your decision." />}
        {r.remediation?.status === "pending" && <Pill text="ATTESTED" color={C.amber} title="You've marked this remediated — pending analyst verification." />}
        {r.remediation?.status === "verified" && <Pill text="VERIFIED" color={C.green} title="Remediation verified by your analyst." />}
        <Pill text={STATUS_LABEL[r.status]} color={color} />
      </div>

      {open && (
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${C.border}` }}>
          {r.text && <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "10px 0" }}>{safeText(r.text)}</p>}
          {r.citation && <div style={{ color: C.textMut, fontSize: 11, marginBottom: 8 }}>{safeText(r.citation)}</div>}

          {r.controls.map(c => (
            <div key={c.controlId} style={{ background: C.surface, borderRadius: 6, padding: "9px 11px", marginBottom: 6 }}>
              <div style={{ color: C.textSec, fontSize: 11.5, marginBottom: 4 }}>{safeText(c.question)}</div>
              <div style={{ color: c.meets ? C.green : C.amber, fontSize: 12 }}>
                {c.answer ? safeText(c.answer) : <span style={{ color: C.textMut }}>Not answered</span>}
                {c.score !== null && <span style={{ color: C.textMut, marginLeft: 6 }}>({c.score}/100)</span>}
              </div>

              {/* Rule 2: both sources visible on the control itself. */}
              {c.sources?.agent?.length > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>
                    AGENT MEASURED {c.sources.agree ? "· AGREES" : "· DISAGREES"}
                  </div>
                  {c.sources.agent.map((a, i) => (
                    <div key={i} style={{ color: c.sources.agree ? C.green : C.amber, fontSize: 11.5 }}>
                      {a.pass} pass / {a.fail} fail across {a.hosts} host(s)
                    </div>
                  ))}
                  {!c.sources.agree && (
                    <div style={{ color: C.textMut, fontSize: 10.5, marginTop: 4, lineHeight: 1.5 }}>
                      Your answer decides this control. Resolve the conflict to change it.
                    </div>
                  )}
                </div>
              )}

              {!c.meets && c.bestAnswer && (
                <div style={{ color: C.textMut, fontSize: 11, marginTop: 5 }}>
                  Target: {safeText(c.bestAnswer)}
                </div>
              )}

              {/* Editing while there's a live agent disagreement would bypass the
                  Conflict Queue's resolution/audit path above (which is the
                  message shown in that case) — so the inline editor only offers
                  itself when there's nothing to reconcile. */}
              {authFetch && !(c.sources?.agent?.length > 0 && !c.sources.agree) && (
                <ControlAnswerEditor c={c} authFetch={authFetch} apiBase={apiBase}
                  clientId={clientId} onSaved={onSaved} />
              )}
            </div>
          ))}

          {authFetch && (
            <RemediationAttest r={r} frameworkId={frameworkId} authFetch={authFetch}
              apiBase={apiBase} clientId={clientId} onSaved={onSaved} />
          )}
        </div>
      )}
    </div>
  );
}

// Inline "fix this answer" editor for one control. Calls the already-built
// POST /api/compliance/answer (had no frontend caller before this) — a
// client no longer has to go through the blunt whole-checklist "Edit
// Assessment" flow, or wait for the Conflict Queue, just to correct one
// wrong answer inside a framework's walkthrough.
function ControlAnswerEditor({ c, authFetch, apiBase, clientId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { text, tone }

  async function pick(option) {
    if (option.label === c.answer || saving) return;
    setSaving(true); setMsg(null);
    try {
      const res = await authFetch(`${apiBase}/api/compliance/answer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId: c.controlId, answer: option.label, clientId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save that answer.");
      const delta = data.posture?.delta;
      setMsg({
        text: `Saved.${delta ? ` Posture ${delta > 0 ? "+" : ""}${delta}.` : ""}`,
        tone: C.green,
      });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setMsg({ text: e.message, tone: C.red });
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 6 }}>
        <button onClick={() => { setEditing(true); setMsg(null); }}
          style={{ background: "none", border: "none", color: C.accent, fontSize: 11,
            fontWeight: 600, cursor: "pointer", padding: 0 }}>
          Update answer
        </button>
        {msg && <span style={{ color: msg.tone, fontSize: 11, marginLeft: 10 }}>{msg.text}</span>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {c.options.map(o => (
          <button key={o.label} onClick={() => pick(o)} disabled={saving}
            style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 11, textAlign: "left",
              cursor: saving ? "wait" : "pointer",
              border: `1px solid ${o.label === c.answer ? C.accent : C.border}`,
              background: o.label === c.answer ? `${C.accent}1A` : "transparent",
              color: o.label === c.answer ? C.accent : C.textSec,
            }}>
            {safeText(o.label)}
          </button>
        ))}
        <button onClick={() => setEditing(false)} disabled={saving}
          style={{ background: "none", border: "none", color: C.textMut, fontSize: 11, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
      {msg && <div style={{ color: msg.tone, fontSize: 11, marginTop: 6 }}>{msg.text}</div>}
    </div>
  );
}

function Note({ children, tone }) {
  const col = tone === "red" ? C.red : tone === "amber" ? C.amber : C.textSec;
  return (
    <div style={{
      background: tone ? `${col}0D` : C.surface,
      border: `1px solid ${tone ? col + "33" : C.border}`,
      borderRadius: 8, padding: "11px 13px", marginBottom: 12,
      color: tone ? col : C.textSec, fontSize: 12, lineHeight: 1.6,
    }}>{children}</div>
  );
}

// ── Custom frameworks ──────────────────────────────────────────
// Admin-defined frameworks (see AdminCustomFrameworksPanel in App.jsx),
// tracked per control here — same honesty rules as the built-in engine:
// status is agent-measured where possible, otherwise self-reported, never
// guessed. Renders nothing if the account has none defined yet.
const CT_STATUS_COLOR = { met: C.green, partial: C.amber, not_met: C.red, unknown: C.textMut };
const CT_STATUS_LABEL = { met: "Met", partial: "Partial", not_met: "Not met", unknown: "Not assessed" };
const CT_SOURCE_LABEL = { agent: "Agent-measured", client: "Self-reported", unset: "Not set" };

export function CustomFrameworksSection({ authFetch, apiBase, clientId }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    authFetch(`${apiBase}/api/frameworks`)
      .then(r => r.json()).then(d => setList(d.frameworks || []))
      .catch(() => setList([]));
  }, [apiBase]);

  if (!list || list.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: "0 0 4px" }}>Custom frameworks</h3>
      <p style={{ color: C.textSec, fontSize: 12.5, lineHeight: 1.6, margin: "0 0 16px" }}>
        Added for this account beyond the standard catalogue. Tracked per control — each is
        either measured by your monitoring agent or self-reported by you, never guessed.
      </p>

      {openId ? (
        <CustomFrameworkDetail authFetch={authFetch} apiBase={apiBase} clientId={clientId}
          frameworkId={openId} onBack={() => setOpenId(null)} />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.map(f => (
            <div key={f.id} onClick={() => setOpenId(f.id)} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "14px 16px", cursor: "pointer",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{safeText(f.name)}</span>
                <Pill text="CUSTOM" color={C.purple} />
                <span style={{ marginLeft: "auto", color: C.textSec, fontSize: 12 }}>
                  {f.controlCount} control{f.controlCount === 1 ? "" : "s"}
                </span>
              </div>
              {f.description && (
                <div style={{ color: C.textSec, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{safeText(f.description)}</div>
              )}
              {f.controlCount === 0 && (
                <div style={{ color: C.textMut, fontSize: 11, marginTop: 6 }}>
                  No controls defined yet — nothing to assess until an admin adds them.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomFrameworkDetail({ authFetch, apiBase, clientId, frameworkId, onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [openControl, setOpenControl] = useState(null);
  const [noteDraft, setNoteDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [remediation, setRemediation] = useState({});
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  const load = useCallback(() => {
    authFetch(`${apiBase}/api/compliance/${frameworkId}/status${q}`)
      .then(r => r.json()).then(d => { if (!d.error) setData(d); else setErr(d.error); })
      .catch(e => setErr(e.message));
  }, [apiBase, frameworkId, clientId]);
  useEffect(load, [load]);

  async function setStatus(controlId, status) {
    setBusy(controlId);
    try {
      const res = await authFetch(`${apiBase}/api/compliance/${frameworkId}/control/${controlId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: noteDraft[controlId] || "", clientId }),
      });
      if (res.ok) load();
    } finally { setBusy(null); }
  }

  async function getRemediation(controlId) {
    setRemediation(s => ({ ...s, [controlId]: "loading" }));
    try {
      const res = await authFetch(`${apiBase}/api/compliance/${frameworkId}/control/${controlId}/remediation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not generate remediation guidance.");
      setRemediation(s => ({ ...s, [controlId]: d.remediation }));
    } catch (e) {
      setRemediation(s => ({ ...s, [controlId]: { error: e.message } }));
    }
  }

  if (err) return <Note tone="red">{err}</Note>;
  if (!data) return <Note>Loading…</Note>;

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: C.accent, cursor: "pointer",
        fontSize: 12, padding: 0, marginBottom: 10,
      }}>← All custom frameworks</button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h4 style={{ color: C.text, fontSize: 15, fontWeight: 700, margin: 0 }}>{safeText(data.name)}</h4>
        <Pill text="CUSTOM" color={C.purple} />
        <span style={{ marginLeft: "auto", color: C.textSec, fontSize: 12 }}>
          {pct(data.compliancePct)} of {data.total} met
        </span>
      </div>
      {data.description && (
        <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>{safeText(data.description)}</p>
      )}
      {data.total === 0 && <Note>No controls have been defined for this framework yet.</Note>}

      <div style={{ display: "grid", gap: 8 }}>
        {data.controls.map(c => {
          const open = openControl === c.id;
          const color = CT_STATUS_COLOR[c.status] || C.textMut;
          return (
            <div key={c.id} style={{
              background: C.card, borderRadius: 8,
              border: `1px solid ${c.agentSuggests ? C.amber + "66" : C.border}`,
            }}>
              <div onClick={() => setOpenControl(open ? null : c.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span style={{ color: C.textSec, fontSize: 11.5, fontFamily: "monospace", minWidth: 40 }}>{safeText(c.id)}</span>
                <span style={{ color: C.text, fontSize: 12.5, flex: 1 }}>{safeText(c.title)}</span>
                {c.source !== "unset" && <Pill text={(CT_SOURCE_LABEL[c.source] || c.source).toUpperCase()} color={C.textSec} />}
                <Pill text={CT_STATUS_LABEL[c.status] || c.status} color={color} />
              </div>

              {open && (
                <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}>
                  {c.description && <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "10px 0" }}>{safeText(c.description)}</p>}
                  {c.category && <div style={{ color: C.textMut, fontSize: 11, marginBottom: 8 }}>Category: {safeText(c.category)}</div>}

                  {c.source === "agent" && (
                    <div style={{ color: C.purple, fontSize: 11, marginBottom: 8 }}>
                      Measured by your monitoring agent{c.note ? `: ${c.note}` : "."}
                    </div>
                  )}
                  {c.agentSuggests && (
                    <div style={{ background: `${C.amber}0D`, borderRadius: 6, padding: "8px 10px", marginBottom: 8, color: C.amber, fontSize: 11, lineHeight: 1.5 }}>
                      Your recorded status is "{CT_STATUS_LABEL[c.status]}", but the agent suggests
                      "{CT_STATUS_LABEL[c.agentSuggests]}". Your attestation decides — update it below if the agent is right.
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {["met", "partial", "not_met", "unknown"].map(s => (
                      <button key={s} onClick={() => setStatus(c.id, s)} disabled={busy === c.id}
                        style={{
                          padding: "5px 10px", borderRadius: 6, fontSize: 11,
                          cursor: busy === c.id ? "default" : "pointer",
                          border: `1px solid ${c.status === s ? CT_STATUS_COLOR[s] : C.border}`,
                          background: c.status === s ? `${CT_STATUS_COLOR[s]}1A` : "transparent",
                          color: c.status === s ? CT_STATUS_COLOR[s] : C.textSec,
                          fontWeight: c.status === s ? 700 : 500,
                        }}>{CT_STATUS_LABEL[s]}</button>
                    ))}
                  </div>
                  <input value={noteDraft[c.id] ?? c.note ?? ""} onChange={e => setNoteDraft(s => ({ ...s, [c.id]: e.target.value }))}
                    placeholder="Optional note (context for your analyst or an auditor)"
                    style={{
                      width: "100%", padding: "7px 10px", borderRadius: 6, fontSize: 12, marginBottom: 8,
                      background: C.surface, color: C.text, border: `1px solid ${C.border}`,
                    }} />

                  {c.status !== "met" && (
                    <div>
                      <button onClick={() => getRemediation(c.id)} disabled={remediation[c.id] === "loading"}
                        style={{
                          padding: "6px 12px", borderRadius: 6, border: "none",
                          cursor: remediation[c.id] === "loading" ? "default" : "pointer",
                          fontSize: 11.5, fontWeight: 700, color: C.bg,
                          background: `linear-gradient(135deg, ${C.accent}, ${C.accentDm})`,
                        }}>
                        {remediation[c.id] === "loading" ? "Thinking…" : "Get remediation guidance"}
                      </button>
                      {remediation[c.id] && remediation[c.id] !== "loading" && (
                        remediation[c.id].error ? (
                          <div style={{ color: C.red, fontSize: 11.5, marginTop: 8 }}>{safeText(remediation[c.id].error)}</div>
                        ) : (
                          <div style={{ marginTop: 10, background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ color: C.text, fontSize: 12, marginBottom: 8 }}>{safeText(remediation[c.id].summary)}</div>
                            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                              {(remediation[c.id].steps || []).map((s, i) => (
                                <div key={i} style={{ fontSize: 11.5, color: C.textSec, lineHeight: 1.5 }}>
                                  <span style={{ color: C.accent, fontWeight: 700 }}>{i + 1}.</span> {safeText(s.action)}
                                  {s.how && <div style={{ color: C.textMut, marginLeft: 14 }}>{safeText(s.how)}</div>}
                                  {s.effort && <span style={{ color: C.textMut, marginLeft: 6 }}>({safeText(s.effort)} effort)</span>}
                                </div>
                              ))}
                            </div>
                            {remediation[c.id].evidence && (
                              <div style={{ fontSize: 11, color: C.textMut, lineHeight: 1.5 }}>
                                Evidence to keep: {safeText(remediation[c.id].evidence)}
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The workspace ─────────────────────────────────────────────
export default function ComplianceWorkspace({ authFetch, apiBase = "", clientId = null }) {
  const [view, setView] = useState(null);
  const [nonce, setNonce] = useState(0);
  return (
    <div>
      <ConflictQueue key={`cq${nonce}`} authFetch={authFetch} apiBase={apiBase}
        clientId={clientId} onResolved={() => setNonce(n => n + 1)} />
      {view
        ? <FrameworkDetail key={`fd${nonce}${view}`} authFetch={authFetch} apiBase={apiBase}
            frameworkId={view} clientId={clientId} onBack={() => setView(null)} />
        : (
          <>
            <ComplianceOverview key={`ov${nonce}`} authFetch={authFetch} apiBase={apiBase}
              clientId={clientId} onOpen={setView} />
            <CustomFrameworksSection key={`cf${nonce}`} authFetch={authFetch} apiBase={apiBase} clientId={clientId} />
          </>
        )}
    </div>
  );
}
