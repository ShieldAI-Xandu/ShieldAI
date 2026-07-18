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

  if (err) return <Note tone="red">Couldn't load compliance: {err}</Note>;
  if (!data) return <Note>Loading…</Note>;
  if (!data.hasAssessment) {
    return <Note>{data.note || "No assessment on file. Compliance can't be determined without answers."}</Note>;
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
              <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{f.short || f.name}</span>
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
                {f.pctSuppressedReason}
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

// ── The conflict queue ────────────────────────────────────────
// Where the agent and the questionnaire disagree. This is the decision point:
// both values shown, three options, nothing auto-resolved.
export function ConflictQueue({ authFetch, apiBase, clientId, onResolved }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reason, setReason] = useState({});
  const [newAnswer, setNewAnswer] = useState({});
  const q = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";

  const load = useCallback(() => {
    authFetch(`${apiBase}/api/compliance/conflicts${q}`)
      .then(r => r.json()).then(setData).catch(() => setData({ conflicts: [] }));
  }, [apiBase, clientId]);
  useEffect(load, [load]);

  async function resolve(c, decision) {
    if (decision === "out-of-scope" && !String(reason[c.controlId] || "").trim()) return;
    if (decision === "update-answer" && !newAnswer[c.controlId]) return;
    setBusy(c.controlId + decision);
    try {
      const res = await authFetch(`${apiBase}/api/compliance/conflicts/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          controlId: c.controlId, decision, clientId,
          reason: reason[c.controlId], newAnswer: newAnswer[c.controlId],
        }),
      });
      if (res.ok) { load(); onResolved && onResolved(); }
    } finally { setBusy(null); }
  }

  if (!data) return null;
  if (!data.reportingHosts) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6 }}>{data.note}</div>
      </div>
    );
  }
  if (!data.conflicts?.length) {
    return (
      <div style={{ background: `${C.green}0D`, border: `1px solid ${C.green}33`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ color: C.green, fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
          Agent and answers agree
        </div>
        <div style={{ color: C.textSec, fontSize: 11.5 }}>
          {data.confirmed?.length || 0} control(s) independently confirmed across {data.reportingHosts} host(s).
          That's measured evidence — worth showing an auditor.
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
        endpoints, and you know your environment. {data.boundary}
      </p>

      {data.conflicts.map(c => (
        <div key={c.controlId} style={{
          background: C.card, border: `1px solid ${C.amber}44`, borderRadius: 10,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <div style={{ color: C.text, fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>{c.question}</div>

          {/* Both sources, side by side. Rule 2. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 0.6, marginBottom: 4 }}>
                YOU SAID · DECIDES
              </div>
              <div style={{ color: C.text, fontSize: 12.5 }}>{c.yourAnswer}</div>
            </div>
            <div style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, letterSpacing: 0.6, marginBottom: 4 }}>
                AGENT MEASURED · INFORMS
              </div>
              <div style={{ color: C.text, fontSize: 12.5 }}>{c.agentObserved.summary}</div>
              {c.agentObserved.perHost?.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {c.agentObserved.perHost.map((h, i) => (
                    <span key={i} style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 4,
                      background: h.status === "pass" ? `${C.green}1A` : `${C.red}1A`,
                      color: h.status === "pass" ? C.green : C.red,
                    }}>{h.host}: {h.observed}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 12 }}>
            The agent can see: {c.agentObserved.whatItSees} — but not: {c.agentObserved.whatItCannotSee}
          </div>

          {c.previouslyResolved && (
            <div style={{ background: `${C.amber}0D`, borderRadius: 6, padding: "8px 10px", marginBottom: 10 }}>
              <span style={{ color: C.amber, fontSize: 11 }}>
                You resolved this before ({c.previouslyResolved.decision}) and the telemetry still disagrees.
              </span>
            </div>
          )}

          {/* The decision. Rule 2: the client chooses. */}
          <div style={{ display: "grid", gap: 8 }}>
            {c.resolution.options.map(o => (
              <div key={o.id} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ color: C.text, fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>{o.label}</div>
                <div style={{ color: C.textSec, fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>{o.effect}</div>

                {o.id === "update-answer" && (
                  <select value={newAnswer[c.controlId] || ""} onChange={e => setNewAnswer(s => ({ ...s, [c.controlId]: e.target.value }))}
                    style={{
                      width: "100%", marginBottom: 8, padding: "6px 8px", borderRadius: 6,
                      background: C.bg, color: C.text, border: `1px solid ${C.border}`, fontSize: 12,
                    }}>
                    <option value="">Choose the answer that matches reality…</option>
                    {(c.validAnswers || []).map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
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
            ))}
          </div>
        </div>
      ))}
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

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ color: C.text, fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{data.title}</div>
      <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>{data.why}</p>

      {data.questions.map(qq => (
        <div key={qq.id} style={{ marginBottom: 12 }}>
          <div style={{ color: C.text, fontSize: 12.5, marginBottom: 4 }}>{qq.question}</div>
          {qq.help && <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 6 }}>{qq.help}</div>}
          <div style={{ display: "grid", gap: 5 }}>
            {qq.options.map((o, i) => {
              const sel = JSON.stringify(answers[qq.id]) === JSON.stringify(o.value);
              return (
                <button key={i} disabled={o.locked}
                  onClick={() => setAnswers(s => ({ ...s, [qq.id]: o.value }))}
                  style={{
                    textAlign: "left", padding: "7px 10px", borderRadius: 6, fontSize: 12,
                    cursor: o.locked ? "default" : "pointer",
                    background: sel ? `${C.accent}1A` : C.surface,
                    color: sel ? C.accent : C.textSec,
                    border: `1px solid ${sel ? C.accent + "66" : C.border}`,
                  }}>{o.label}</button>
              );
            })}
          </div>
        </div>
      ))}

      {data.status && !data.status.complete && (
        <div style={{ color: C.textMut, fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
          If you skip this: {data.status.defaultIfSkipped}
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
            {result.suggestionNote}
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
  if (!data.hasAssessment) return <Note>{data.note}</Note>;

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
        <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>{data.framework.name}</h3>
        <DepthBadge depth={data.depth} />
      </div>
      {data.framework.citation && (
        <div style={{ color: C.textMut, fontSize: 11, marginBottom: 8 }}>{data.framework.citation}</div>
      )}
      {data.framework.note && (
        <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 10px" }}>{data.framework.note}</p>
      )}

      {data.notControlMapped ? (
        <Note tone="amber">{data.why}</Note>
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
                    <span style={{ color: C.textSec, fontSize: 11.5, fontWeight: 700 }}>{e.id}</span>
                    <span style={{ color: C.textMut, fontSize: 11, marginLeft: 8 }}>{e.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            {reqs.map(r => <RequirementRow key={r.id} r={r} />)}
          </div>

          {data.detail?.disclaimer && (
            <div style={{ marginTop: 16, color: C.textMut, fontSize: 11, lineHeight: 1.6 }}>
              {data.detail.disclaimer}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RequirementRow({ r }) {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLOR[r.status];
  return (
    <div style={{
      background: C.card, borderRadius: 8,
      border: `1px solid ${r.hasDispute ? C.amber + "66" : C.border}`,
    }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", cursor: "pointer" }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span style={{ color: C.textSec, fontSize: 11.5, fontFamily: "monospace", minWidth: 62 }}>{r.id}</span>
        <span style={{ color: C.text, fontSize: 12.5, flex: 1 }}>{r.name}</span>
        {r.hasCorroboration && <Pill text="AGENT-CONFIRMED" color={C.green} title="Independently confirmed by the monitoring agent — measured evidence, not a self-assessment." />}
        {r.hasDispute && <Pill text="CONFLICT" color={C.amber} title="Your answer and the agent's measurement disagree. Needs your decision." />}
        <Pill text={STATUS_LABEL[r.status]} color={color} />
      </div>

      {open && (
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${C.border}` }}>
          {r.text && <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "10px 0" }}>{r.text}</p>}
          {r.citation && <div style={{ color: C.textMut, fontSize: 11, marginBottom: 8 }}>{r.citation}</div>}

          {r.controls.map(c => (
            <div key={c.controlId} style={{ background: C.surface, borderRadius: 6, padding: "9px 11px", marginBottom: 6 }}>
              <div style={{ color: C.textSec, fontSize: 11.5, marginBottom: 4 }}>{c.question}</div>
              <div style={{ color: c.meets ? C.green : C.amber, fontSize: 12 }}>
                {c.answer || <span style={{ color: C.textMut }}>Not answered</span>}
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
                  Target: {c.bestAnswer}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
        : <ComplianceOverview key={`ov${nonce}`} authFetch={authFetch} apiBase={apiBase}
            clientId={clientId} onOpen={setView} />}
    </div>
  );
}
