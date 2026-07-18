// src/AnalystPortfolio.jsx
// The analyst's triage view — the frontend for portfolioRoutes.js.
//
// WHY THIS FILE EXISTS
// --------------------
// portfolioRoutes.js was written, tested, and never registered in server.js, so
// every /api/analyst/* endpoint returned the SPA's index.html. Its changelog
// recorded access control as "verified via runtime smoke test", which cannot
// have gone through HTTP while the route was unreachable — module-level tests
// pass while a feature is unreachable. The route is registered now and isolation
// is verified over real HTTP (assigned client 200, unassigned 403). This is the
// UI that makes it usable.
//
// WHAT AN ANALYST NEEDS, IN ORDER
// --------------------------------
// 1. Which client needs me right now.  2. Why.  3. One click to the evidence.
//
// So the list sorts by triage rank, not alphabetically, and every row carries
// the reason it's ranked where it is. An analyst covering fifteen SMBs opens
// this first and should be able to close it in ten seconds if nothing's wrong.
//
// THE RULES THIS UI MUST NOT BREAK
// ---------------------------------
// 1. Unknown is not "on track". A client with no assessment renders as UNKNOWN,
//    never green. Green against a client we've never scored tells a human to
//    look away — the one thing a triage view must never do.
// 2. Conflicts outrank scores. Agent telemetry contradicting a client's answers
//    means every framework built on that answer is suspect. It sorts to the top.
// 3. Isolation is the backend's job, not the UI's. This renders what the API
//    returns. It never filters client lists client-side — a UI-side filter is a
//    leak waiting for someone to open devtools.

import React, { useState, useEffect, useCallback } from "react";
import ComplianceWorkspace from "./ComplianceWorkspace.jsx";

const C = {
  bg: "#080D18", surface: "#0D1526", card: "#101C30", cardHov: "#142035",
  border: "#1A2D47", borderHi: "#254060", accent: "#00C8FF", accentDm: "#0090BB",
  green: "#00E5A0", amber: "#FFB800", red: "#FF4D6A", purple: "#A855F7",
  text: "#E2EDFF", textSec: "#7B92B2", textMut: "#2E4A6A",
};

// Rule 1, in one place: unknown is its own state, not a shade of fine.
const STATUS_META = {
  attention:    { label: "ATTENTION",   color: C.red,     why: "Agent offline, or posture below 40." },
  needs_review: { label: "NEEDS REVIEW", color: C.amber,   why: "Open conflicts, open items, or posture below 60." },
  unknown:      { label: "UNKNOWN",      color: C.purple,  why: "No assessment on file. We have not scored this client — this is a gap in coverage, not a pass." },
  on_track:     { label: "ON TRACK",     color: C.green,   why: "Scored, no open items, agent healthy." },
};

const LEVEL_COLOR = { Strong: C.green, Moderate: C.amber, Weak: C.red, "At Risk": C.red };

function Pill({ text, color, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
      background: `${color}1A`, color, border: `1px solid ${color}44`,
    }}>{text}</span>
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

// ── Portfolio list ────────────────────────────────────────────
function PortfolioList({ authFetch, apiBase, onOpen }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let live = true;
    authFetch(`${apiBase}/api/analyst/portfolio`)
      .then(async r => {
        if (r.status === 403) throw new Error("Analyst access required.");
        return r.json();
      })
      .then(d => { if (live) setRows(Array.isArray(d) ? d : (d.clients || [])); })
      .catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [apiBase]);

  if (err) return <Note tone="red">{err}</Note>;
  if (!rows) return <Note>Loading portfolio…</Note>;
  if (!rows.length) {
    return <Note>No clients assigned to you yet. An admin assigns clients — you only ever see your own.</Note>;
  }

  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const totalConflicts = rows.reduce((n, r) => n + (r.conflicts || 0), 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <h3 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Your clients</h3>
        <span style={{ color: C.textSec, fontSize: 12 }}>{rows.length} assigned</span>
      </div>
      <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.6, margin: "0 0 12px" }}>
        Sorted by what needs you first, not alphabetically. You see only clients assigned to
        you — that scoping is enforced server-side.
      </p>

      {/* Triage summary */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {["attention", "needs_review", "unknown", "on_track"].map(s =>
          counts[s] ? (
            <Pill key={s} text={`${counts[s]} ${STATUS_META[s].label}`}
              color={STATUS_META[s].color} title={STATUS_META[s].why} />
          ) : null
        )}
        {totalConflicts > 0 && (
          <Pill text={`${totalConflicts} AGENT CONFLICT${totalConflicts > 1 ? "S" : ""}`} color={C.amber}
            title="The agent measured something that contradicts what the client told us. Only a human can settle it." />
        )}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {rows.map(r => <ClientRow key={r.id} r={r} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function ClientRow({ r, onOpen }) {
  const meta = STATUS_META[r.status] || STATUS_META.unknown;
  const [hover, setHover] = useState(false);

  return (
    <div onClick={() => onOpen(r)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? C.cardHov : C.card,
        border: `1px solid ${r.status === "attention" ? C.red + "55" : r.conflicts > 0 ? C.amber + "44" : C.border}`,
        borderRadius: 10, padding: "13px 15px", cursor: "pointer",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: meta.color, flexShrink: 0 }} />
        <span style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>{r.name}</span>
        <Pill text={String(r.plan || r.tier || "free").toUpperCase()} color={C.textSec} />
        <span style={{ marginLeft: "auto" }} />
        {r.conflicts > 0 && (
          <Pill text={`${r.conflicts} CONFLICT${r.conflicts > 1 ? "S" : ""}`} color={C.amber}
            title="Agent telemetry disagrees with this client's answers. Needs a human decision." />
        )}
        <Pill text={meta.label} color={meta.color} title={meta.why} />
      </div>

      <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 11.5 }}>
        {/* Rule 1: no score is not a zero and not a pass. */}
        <span style={{ color: C.textSec }}>
          Posture{" "}
          {r.posture === null || r.posture === undefined ? (
            <span style={{ color: C.purple, fontWeight: 700 }} title="No assessment on file — we haven't scored this client.">
              not scored
            </span>
          ) : (
            <>
              <span style={{ color: LEVEL_COLOR[r.level] || C.text, fontWeight: 700 }}>{r.posture}</span>
              <span style={{ color: C.textMut }}> · {r.level}</span>
            </>
          )}
        </span>

        <span style={{ color: C.textSec }}>
          Agent{" "}
          <span style={{ color: r.agent?.status === "offline" ? C.red : r.agent?.status === "pending" ? C.textMut : C.green }}>
            {r.agent?.endpoints ? `${r.agent.healthy}/${r.agent.endpoints} healthy` : "none enrolled"}
          </span>
        </span>

        {r.openItems > 0 && <span style={{ color: C.amber }}>{r.openItems} open item{r.openItems > 1 ? "s" : ""}</span>}

        {r.weakest?.length > 0 && (
          <span style={{ color: C.textMut, marginLeft: "auto" }}>Weakest: {r.weakest.join(", ")}</span>
        )}
      </div>

      {/* Why this client sits where it does. An analyst shouldn't have to guess. */}
      {r.status === "unknown" && (
        <div style={{ marginTop: 8, color: C.purple, fontSize: 11, lineHeight: 1.5 }}>
          No assessment on file. Nothing here is a pass — we simply haven't asked yet.
        </div>
      )}
      {r.postureSource === "assessment" && !r.hasProgram && (
        <div style={{ marginTop: 8, color: C.textMut, fontSize: 10.5 }}>
          Scored from their assessment — no program generated yet.
        </div>
      )}
    </div>
  );
}

// ── Client detail ─────────────────────────────────────────────
function ClientDetail({ authFetch, apiBase, client, onBack }) {
  const [tab, setTab] = useState("compliance");
  const [queue, setQueue] = useState(null);
  const [history, setHistory] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState({});
  const id = client.id;

  const loadQueue = useCallback(() => {
    authFetch(`${apiBase}/api/analyst/clients/${id}/review-queue`)
      .then(r => r.json()).then(d => setQueue(d.queue || [])).catch(() => setQueue([]));
  }, [apiBase, id]);

  useEffect(() => {
    loadQueue();
    authFetch(`${apiBase}/api/analyst/clients/${id}/posture-history`)
      .then(r => r.json()).then(setHistory).catch(() => setHistory(null));
    authFetch(`${apiBase}/api/analyst/clients/${id}/alerts`)
      .then(r => r.json()).then(d => setAlerts(d.alerts || [])).catch(() => setAlerts([]));
  }, [apiBase, id, loadQueue]);

  async function decide(item, decision) {
    setBusy(item.id + decision);
    try {
      const res = await authFetch(`${apiBase}/api/analyst/clients/${id}/review-decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, decision, note: note[item.id] || "" }),
      });
      if (res.ok) loadQueue();
    } finally { setBusy(null); }
  }

  const pending = (queue || []).filter(q => q.reviewStatus === "awaiting_review");

  return (
    <div>
      <button onClick={onBack} style={{
        background: "none", border: "none", color: C.accent, cursor: "pointer",
        fontSize: 12, padding: 0, marginBottom: 10,
      }}>← All clients</button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
        <h3 style={{ color: C.text, fontSize: 17, fontWeight: 700, margin: 0 }}>{client.name}</h3>
        <Pill text={(STATUS_META[client.status] || STATUS_META.unknown).label}
          color={(STATUS_META[client.status] || STATUS_META.unknown).color} />
      </div>
      <div style={{ color: C.textMut, fontSize: 11.5, marginBottom: 14 }}>
        {client.email} · {client.plan || client.tier}
        {client.scoredAt && ` · last scored ${new Date(client.scoredAt).toLocaleDateString()}`}
      </div>

      {/* Posture trend — sparkline, not a chart library. */}
      {history?.points?.length > 1 && <Sparkline points={history.points} current={history.current} />}

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          ["compliance", "Compliance"],
          ["review", pending.length ? `Review (${pending.length})` : "Review"],
          ["alerts", alerts?.length ? `Alerts (${alerts.length})` : "Alerts"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              padding: "5px 12px", borderRadius: 999, fontSize: 11.5, cursor: "pointer",
              border: `1px solid ${tab === k ? C.accent : C.border}`,
              background: tab === k ? `${C.accent}1A` : "transparent",
              color: tab === k ? C.accent : C.textSec,
            }}>{label}</button>
        ))}
      </div>

      {tab === "compliance" && (
        // The same workspace the client sees, scoped to this client. One
        // implementation, so an analyst and their client can never be looking at
        // two different answers to the same question.
        <ComplianceWorkspace authFetch={authFetch} apiBase={apiBase} clientId={id} />
      )}

      {tab === "review" && (
        <div>
          {!queue ? <Note>Loading…</Note>
            : !queue.length ? <Note>Nothing awaiting review.</Note>
            : queue.map(item => (
              <div key={item.id} style={{
                background: C.card, border: `1px solid ${item.reviewStatus === "awaiting_review" ? C.amber + "44" : C.border}`,
                borderRadius: 10, padding: "13px 15px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Pill text={String(item.kind || "").toUpperCase()} color={C.textSec} />
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{item.title || item.name || item.id}</span>
                  <span style={{ marginLeft: "auto" }}>
                    <Pill text={String(item.reviewStatus || "").replace(/_/g, " ").toUpperCase()}
                      color={item.reviewStatus === "approved" ? C.green : item.reviewStatus === "changes_requested" ? C.red : C.amber} />
                  </span>
                </div>

                {item.reviewStatus === "awaiting_review" && (
                  <>
                    <input value={note[item.id] || ""} onChange={e => setNote(s => ({ ...s, [item.id]: e.target.value }))}
                      placeholder="Note (required when requesting changes)"
                      style={{
                        width: "100%", marginBottom: 8, padding: "6px 9px", borderRadius: 6,
                        background: C.bg, color: C.text, border: `1px solid ${C.border}`, fontSize: 12,
                      }} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => decide(item, "approve")} disabled={busy === item.id + "approve"}
                        style={{
                          padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                          fontSize: 11.5, fontWeight: 700, color: C.bg,
                          background: `linear-gradient(135deg, ${C.green}, #00B37E)`,
                        }}>{busy === item.id + "approve" ? "…" : "Approve"}</button>
                      <button onClick={() => decide(item, "request_changes")} disabled={busy === item.id + "request_changes"}
                        style={{
                          padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                          fontSize: 11.5, fontWeight: 700, color: C.amber,
                          background: "transparent", border: `1px solid ${C.amber}66`,
                        }}>{busy === item.id + "request_changes" ? "…" : "Request changes"}</button>
                    </div>
                  </>
                )}
                {item.reviewNote && (
                  <div style={{ color: C.textMut, fontSize: 11, marginTop: 6 }}>Note: {item.reviewNote}</div>
                )}
              </div>
            ))}
        </div>
      )}

      {tab === "alerts" && (
        <div>
          {!alerts ? <Note>Loading…</Note>
            : !alerts.length ? <Note>No alerts.</Note>
            : alerts.map((a, i) => (
              <div key={i} style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 13px", marginBottom: 6, display: "flex", gap: 10, alignItems: "center",
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: 3, flexShrink: 0,
                  background: a.severity === "critical" || a.severity === "high" ? C.red : a.severity === "medium" ? C.amber : C.textMut,
                }} />
                <span style={{ color: C.text, fontSize: 12.5, flex: 1 }}>{a.message || a.title}</span>
                <span style={{ color: C.textMut, fontSize: 10.5 }}>
                  {a.ts || a.at ? new Date(a.ts || a.at).toLocaleDateString() : ""}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// Inline SVG sparkline — no chart library for eight data points.
function Sparkline({ points, current }) {
  const vals = points.map(p => p.score ?? p.postureScore).filter(v => typeof v === "number");
  if (vals.length < 2) return null;
  const w = 240, h = 40, min = Math.min(...vals, 0), max = Math.max(...vals, 100);
  const x = i => (i / (vals.length - 1)) * w;
  const y = v => h - ((v - min) / (max - min || 1)) * h;
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const trend = vals[vals.length - 1] - vals[0];

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "12px 15px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16,
    }}>
      <div>
        <div style={{ color: C.textSec, fontSize: 10.5, letterSpacing: 0.5, marginBottom: 2 }}>POSTURE TREND</div>
        <div style={{ color: C.text, fontSize: 20, fontWeight: 700 }}>
          {current?.score ?? vals[vals.length - 1]}
          <span style={{
            fontSize: 12, marginLeft: 8, fontWeight: 600,
            color: trend > 0 ? C.green : trend < 0 ? C.red : C.textMut,
          }}>{trend > 0 ? "▲" : trend < 0 ? "▼" : "—"} {Math.abs(trend)}</span>
        </div>
      </div>
      <svg width={w} height={h} style={{ marginLeft: "auto" }}>
        <path d={d} fill="none" stroke={trend >= 0 ? C.green : C.red} strokeWidth="1.5" />
        {vals.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="1.8" fill={trend >= 0 ? C.green : C.red} />)}
      </svg>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────
export default function AnalystPortfolio({ authFetch, apiBase = "" }) {
  const [client, setClient] = useState(null);
  return client
    ? <ClientDetail authFetch={authFetch} apiBase={apiBase} client={client} onBack={() => setClient(null)} />
    : <PortfolioList authFetch={authFetch} apiBase={apiBase} onOpen={setClient} />;
}
