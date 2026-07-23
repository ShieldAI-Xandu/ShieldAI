// reportRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
//  ShieldAI reporting
//
//  Produces five kinds of report, each as a self-contained, branded HTML
//  document that opens in Microsoft Word (served with a .doc filename) and
//  prints cleanly to PDF. No new dependencies — this mirrors the .doc export
//  pattern already used for policies and training curricula in App.jsx.
//
//  Report types and who may produce them:
//    • status   — client self-serve. Plain-language posture snapshot.
//    • update   — client self-serve. What changed since a chosen date.
//    • compliance — admin/analyst only. Framework-by-framework control posture.
//    • insurance  — admin/analyst only. The attestable-controls subset insurers
//                   ask for on cyber applications/renewals.
//    • legal      — admin/analyst only. A defensible record of what was assessed,
//                   what was recommended, and who acted — built on the immutable
//                   clientActions log (the "AI advises, humans act" trail).
//
//  Staff reports are DELIVERED to the client: generating one stores a record;
//  the client sees delivered reports and can download them. Nothing is exposed
//  to the client until a staff member explicitly delivers it.
//
//  IMPORTANT: every report carries a review disclaimer. These documents are
//  generated from the client's own data and ShieldAI's deterministic engines;
//  they are not a substitute for a licensed auditor, a qualified attorney, or a
//  signed attestation. That line is not decorative — it is what keeps the
//  compliance/insurance/legal outputs honest for their audiences.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import { computePostureScore } from "./riskEngine.js";
import { evaluateAllFrameworks } from "./complianceBridge.js";

const nowIso = () => new Date().toISOString();

// ── Data access helpers (read-only) ──────────────────────────────────────────

function userById(db, id) {
  return (db.data.users || []).find((u) => u.id === id) || null;
}

function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter((a) => a.userId === userId);
  if (!list.length) return null;
  return list.reduce(
    (best, a) =>
      !best ||
      new Date(a.updatedAt || a.createdAt) >
        new Date(best.updatedAt || best.createdAt)
        ? a
        : best,
    null,
  );
}

function checklistOf(assessment) {
  return (
    assessment?.data?.checklist || assessment?.data?.securityChecklist || {}
  );
}

function optsFor(assessment) {
  // Framework scoping answers → per-framework assess opts. Best-effort; a
  // malformed intake must never break a report, so we swallow and skip.
  const stored = assessment?.data?.frameworkIntake || {};
  const out = {};
  for (const [fid, answers] of Object.entries(stored)) {
    if (!answers) continue;
    // toAssessOpts lives in frameworkIntake; importing it here would couple us
    // to its id-normalisation. The overview endpoint already applies scoping,
    // and evaluateAllFrameworks tolerates a bare opts map — so we pass the raw
    // answers through and let each module ignore what it doesn't recognise.
    out[fid] = answers;
  }
  return out;
}

function tasksFor(db, ownerUserId) {
  return (db.data.tasks || []).filter((t) => t.ownerUserId === ownerUserId);
}

function evidenceFor(db, ownerUserId) {
  return (db.data.evidence || []).filter((e) => e.ownerUserId === ownerUserId);
}

function actionsFor(db, clientUserId) {
  return (db.data.clientActions || []).filter(
    (a) => a.clientUserId === clientUserId,
  );
}

// Latest posture report per host for one client (agents report repeatedly).
function endpointsFor(db, ownerUserId) {
  const agents = (db.data.agents || []).filter(
    (a) => a.ownerUserId === ownerUserId && !a.revokedAt,
  );
  const reports = db.data.agentReports || [];
  return agents.map((agent) => {
    const mine = reports
      .filter((r) => r.agentId === agent.id)
      .sort((a, b) => new Date(b.receivedAt || 0) - new Date(a.receivedAt || 0));
    const latest = mine[0];
    const checks = latest?.report?.checks || [];
    const fails = checks.filter((c) => c.status === "fail").length;
    const warns = checks.filter((c) => c.status === "warn").length;
    const posture =
      fails > 0 ? "at_risk" : warns > 0 ? "needs_attention" : "healthy";
    return {
      hostname: agent.hostname,
      os: agent.os,
      lastSeen: agent.lastSeen,
      posture,
      failCount: fails,
      warnCount: warns,
      checkCount: checks.length,
    };
  });
}

// Fixed a real bug here: this used to read db.data.trainingLearners (wrong
// collection — trainingProgramRoutes.js actually stores these at
// db.data.learners) filtered by .ownerUserId (wrong field — the real field is
// .clientUserId). That meant every report referencing training data — the
// Insurance report's "Security awareness training" line in particular — was
// silently showing zero/no-training for every client regardless of their
// actual learners and completions. Also expanded to return the full roster
// (not just counts) so the dedicated training report below can list who's
// assigned, their status, grade, and completion date — not just a percentage.
function trainingFor(db, clientUserId) {
  const learners = (db.data.learners || []).filter(
    (l) => l.clientUserId === clientUserId,
  );
  const assignments = (db.data.trainingAssignments || []).filter(
    (a) => a.clientUserId === clientUserId,
  );
  const done = assignments.filter((a) => a.status === "completed").length;
  const overdue = assignments.filter((a) => a.status === "overdue").length;
  const scores = assignments.map((a) => a.score).filter((s) => typeof s === "number");

  const roster = learners.map((l) => {
    const la = assignments.filter((a) => a.learnerId === l.id);
    const completed = la.filter((a) => a.status === "completed");
    const lScores = completed.map((a) => a.score).filter((s) => typeof s === "number");
    return {
      name: l.name,
      email: l.email,
      department: l.department || "",
      status: l.status,
      assigned: la.length,
      completed: completed.length,
      inProgress: la.filter((a) => a.status === "in_progress").length,
      overdue: la.filter((a) => a.status === "overdue").length,
      avgScore: lScores.length
        ? Math.round(lScores.reduce((s, x) => s + x, 0) / lScores.length)
        : null,
      lastCompletedAt:
        completed.map((a) => a.completedAt).filter(Boolean).sort().pop() || null,
      // Titles of everything currently assigned, for the roster detail table.
      assignmentTitles: la.map((a) => ({ title: a.title, status: a.status, score: a.score ?? null, dueDate: a.dueDate || null })),
    };
  });

  return {
    learners: learners.length,
    assigned: assignments.length,
    completed: done,
    overdue,
    completionPct: assignments.length
      ? Math.round((done / assignments.length) * 100)
      : null,
    avgScore: scores.length
      ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
      : null,
    roster,
  };
}

/**
 * The single source of truth for report content. Every builder consumes this,
 * so all reports about one client agree with each other and with the app.
 */
export function gatherReportData(db, clientId) {
  const client = userById(db, clientId);
  if (!client) return null;

  const assessment = latestAssessmentFor(db, clientId);
  const hasAssessment = !!assessment;
  const checklist = checklistOf(assessment);

  const posture = hasAssessment ? computePostureScore(assessment.data) : null;
  const frameworks = hasAssessment
    ? evaluateAllFrameworks(checklist, optsFor(assessment))
    : [];

  const tasks = tasksFor(db, clientId);
  const openTasks = tasks.filter(
    (t) => !["done", "cancelled"].includes(t.status),
  );
  const overdue = openTasks.filter(
    (t) => t.dueDate && new Date(t.dueDate) < new Date(),
  );

  const evidence = evidenceFor(db, clientId);
  const doneTasks = tasks.filter((t) => t.status === "done");
  const doneWithEvidence = doneTasks.filter((t) =>
    evidence.some((e) => e.kind === "task" && e.refId === t.id),
  ).length;

  return {
    client: {
      id: client.id,
      name: client.companyName || client.email,
      email: client.email,
      industry: client.industry || null,
      tier: client.tier || "free",
    },
    generatedAt: nowIso(),
    hasAssessment,
    assessedAt: assessment
      ? assessment.updatedAt || assessment.createdAt
      : null,
    posture,
    frameworks,
    tasks: {
      total: tasks.length,
      open: openTasks.length,
      overdue: overdue.length,
      done: doneTasks.length,
      byPriority: openTasks.reduce((m, t) => {
        m[t.priority] = (m[t.priority] || 0) + 1;
        return m;
      }, {}),
      openList: openTasks
        .slice()
        .sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3 };
          return (
            (order[a.priority] ?? 9) - (order[b.priority] ?? 9) ||
            (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
          );
        })
        .map((t) => ({
          title: t.title,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate || null,
          controlId: t.controlId || null,
        })),
    },
    evidence: {
      total: evidence.length,
      completedTasks: doneTasks.length,
      completedTasksWithEvidence: doneWithEvidence,
      completedTasksMissingEvidence: doneTasks.length - doneWithEvidence,
    },
    endpoints: endpointsFor(db, clientId),
    training: trainingFor(db, clientId),
    actions: actionsFor(db, clientId),
  };
}

// ── Branded HTML document helpers (mirror App.jsx export helpers) ─────────────

const BRAND = {
  navy: "#080D18",
  ink: "#0B2540",
  cyan: "#00C8FF",
  cyanDk: "#0284C7",
  rule: "#CBD8E6",
  muted: "#5B7088",
  green: "#16B364",
  amber: "#F79009",
  red: "#F04438",
};

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return String(iso);
  }
}

function brandLogoSvg(px = 30) {
  return `<svg viewBox="0 0 64 80" width="${px}" height="${Math.round(
    (px * 80) / 64,
  )}" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle">
  <defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#0EA5E9"/><stop offset="100%" stop-color="#0284C7"/>
  </linearGradient></defs>
  <path d="M32 4 L56 14 L56 38 C56 56 42 68 32 76 C22 68 8 56 8 38 L8 14 Z" fill="url(#sg)"/>
  <path d="M22 28 L32 38 L42 28 M32 38 L32 54" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="22" cy="28" r="3.5" fill="#FFFFFF"/><circle cx="42" cy="28" r="3.5" fill="#FFFFFF"/>
  <circle cx="32" cy="54" r="3.5" fill="#FFFFFF"/><circle cx="32" cy="38" r="4.5" fill="#00E5FF"/>
  <circle cx="32" cy="38" r="2" fill="#FFFFFF"/>
</svg>`;
}

function docHeader(kicker, subtitle) {
  return `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18pt;">
    <tr>
      <td style="vertical-align:middle;padding:0 0 10pt;">
        <span style="display:inline-block;vertical-align:middle;">${brandLogoSvg(30)}</span>
        <span style="display:inline-block;vertical-align:middle;margin-left:8px;font-weight:800;font-size:16pt;letter-spacing:-0.3px;">
          <span style="color:${BRAND.ink}">Shield</span><span style="color:${BRAND.cyan}">AI</span></span>
      </td>
      <td style="vertical-align:middle;text-align:right;padding:0 0 10pt;color:${BRAND.muted};font-size:8.5pt;letter-spacing:0.5px;text-transform:uppercase;">
        Virtual CISO Platform
      </td>
    </tr>
    <tr><td colspan="2" style="border-bottom:2.5pt solid ${BRAND.cyan};font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
  ${kicker ? `<div style="margin:0 0 2pt;font-size:9pt;letter-spacing:1px;text-transform:uppercase;color:${BRAND.cyanDk};font-weight:700;">${esc(kicker)}</div>` : ""}
  ${subtitle ? `<div style="margin:0 0 14pt;font-size:10.5pt;color:${BRAND.muted};">${esc(subtitle)}</div>` : ""}`;
}

function docFooter(disclaimer) {
  const year = new Date().getFullYear();
  return `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:26pt 0 0;">
    <tr><td style="border-top:1pt solid ${BRAND.rule};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:8pt 0 0;color:${BRAND.muted};font-size:8pt;line-height:1.5;">
      <strong style="color:${BRAND.ink}">CONFIDENTIAL</strong> &middot; Prepared by ShieldAI &middot; &copy; ${year} ShieldAI.<br/>
      ${esc(disclaimer)}
    </td></tr>
  </table>`;
}

function docStyles() {
  return `
  body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1A2A3A;line-height:1.5;}
  h1{font-size:20pt;color:${BRAND.ink};margin:0 0 6pt;}
  h2{font-size:14pt;color:${BRAND.cyanDk};border-bottom:1px solid ${BRAND.rule};padding-bottom:3pt;margin:16pt 0 6pt;}
  h3{font-size:12pt;color:${BRAND.ink};margin:10pt 0 4pt;}
  table.content{margin:8pt 0;border-collapse:collapse;width:100%;}
  table.content th{background:#EAF6FC;color:${BRAND.ink};text-align:left;border:1px solid ${BRAND.rule};padding:6px;font-size:10pt;}
  table.content td{border:1px solid ${BRAND.rule};padding:6px;font-size:10pt;vertical-align:top;}
  .meta{color:${BRAND.muted};font-size:10pt;}
  .kpi{display:inline-block;border:1px solid ${BRAND.rule};border-radius:8px;padding:10px 16px;margin:4px 8px 4px 0;}
  .kpi b{display:block;font-size:20pt;color:${BRAND.ink};line-height:1;}
  .kpi span{font-size:8.5pt;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.5px;}
  .note{background:#F4F8FC;border-left:3px solid ${BRAND.cyan};padding:8px 12px;margin:8pt 0;font-size:10pt;color:${BRAND.ink};}
  `;
}

function wrapDoc({ title, kicker, subtitle, body, disclaimer }) {
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title><style>${docStyles()}</style></head>
<body>
${docHeader(kicker, subtitle)}
<h1>${esc(title)}</h1>
${body}
${docFooter(disclaimer)}
</body></html>`;
}

// A small reusable KPI row.
function kpi(value, label) {
  return `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function pct(v) {
  return v === null || v === undefined ? "—" : `${v}%`;
}

function postureBlock(d) {
  if (!d.hasAssessment || !d.posture) {
    return `<div class="note">No completed assessment is on file for this client, so a security posture score cannot be reported. Complete the assessment to populate this section.</div>`;
  }
  const p = d.posture;
  return `
  <div>
    ${kpi(Math.round(p.postureScore), "Posture score")}
    ${kpi(p.postureLevel, "Posture level")}
    ${kpi(fmtDate(d.assessedAt), "Assessed")}
  </div>
  <p class="meta">Methodology: ${esc(p.methodology || "NIST CSF")}. ${
    p.weakestAreas?.length
      ? `Weakest areas: ${esc(p.weakestAreas.join(", "))}.`
      : ""
  }</p>`;
}

// ── Report builders ──────────────────────────────────────────────────────────

const DISCLAIMERS = {
  status:
    "This status report was generated automatically from your ShieldAI data. It reflects the information on file at the time of generation and is intended for internal awareness, not as a formal attestation.",
  update:
    "This update report was generated automatically from your ShieldAI data for the period shown. It is intended for internal awareness of changes, not as a formal attestation.",
  compliance:
    "This compliance report is generated from the client's self-reported assessment answers and ShieldAI's deterministic control-mapping engines. It is a readiness aid, not a certified audit. Framework percentages are computed over assessed controls only. This document does not constitute an audit opinion and should be reviewed by a qualified assessor before being relied upon for certification or regulatory submission.",
  insurance:
    "This report summarizes security controls for the purpose of a cyber-insurance application or renewal. Statements are derived from the client's assessment answers and endpoint data on file; they are not independently verified by ShieldAI. The applicant remains responsible for the accuracy of any representation made to an insurer. Review with your broker or counsel before submission.",
  legal:
    "This report is a record of activity within ShieldAI: what was assessed, what was recommended, and actions taken. ShieldAI provides advisory output; decisions and actions are made by the client and its personnel. This document is not legal advice and does not constitute a legal opinion. It should be reviewed by a licensed attorney before being relied upon in any legal or contractual matter.",
  training:
    "This training-completion report reflects learner records and assignment status on file within ShieldAI as of the generation date. Completion and quiz scores are self-reported by the learner at the time each module was marked complete and are not independently proctored or verified. This document is a readiness aid for compliance, insurance, or legal review — not a certified attestation — and should be verified against your own personnel records before submission to a third party.",
};

function frameworksTable(frameworks) {
  const control = frameworks.filter((f) => !f.notControlMapped);
  if (!control.length) {
    return `<div class="note">No control-mapped frameworks have scored results yet. Frameworks scored by the posture engine or provided as AI-assisted gap analysis are not included in this table.</div>`;
  }
  const rows = control
    .map(
      (f) => `<tr>
      <td><b>${esc(f.name)}</b></td>
      <td>${pct(f.compliancePct)}</td>
      <td>${pct(f.readinessPct)}</td>
      <td>${f.compliant ?? "—"}</td>
      <td>${f.partial ?? "—"}</td>
      <td>${f.gap ?? "—"}</td>
      <td>${f.unknown ?? "—"}</td>
    </tr>`,
    )
    .join("");
  return `<table class="content">
    <tr><th>Framework</th><th>Compliant</th><th>Readiness</th><th>Met</th><th>Partial</th><th>Gap</th><th>Unknown</th></tr>
    ${rows}
  </table>
  <p class="meta">Percentages are computed over assessed controls only; unanswered controls are reported as "unknown" rather than counted against the score.</p>`;
}

function openTasksTable(d, limit = 40) {
  if (!d.tasks.openList.length) {
    return `<div class="note">No open remediation items.</div>`;
  }
  const rows = d.tasks.openList
    .slice(0, limit)
    .map(
      (t) => `<tr>
      <td>${esc(t.title)}</td>
      <td>${esc(t.priority)}</td>
      <td>${esc(t.status)}</td>
      <td>${t.dueDate ? fmtDate(t.dueDate) : "—"}</td>
    </tr>`,
    )
    .join("");
  return `<table class="content">
    <tr><th>Item</th><th>Priority</th><th>Status</th><th>Due</th></tr>
    ${rows}
  </table>`;
}

// 1) CLIENT STATUS — plain-language snapshot (client self-serve)
function buildStatusReport(d) {
  const body = `
  <h2>Where you stand today</h2>
  ${postureBlock(d)}

  <h2>Your security program at a glance</h2>
  <div>
    ${kpi(d.tasks.open, "Open items")}
    ${kpi(d.tasks.overdue, "Overdue")}
    ${kpi(d.tasks.done, "Completed")}
    ${kpi(d.evidence.total, "Evidence on file")}
  </div>
  ${
    d.endpoints.length
      ? `<p class="meta">${d.endpoints.length} monitored endpoint(s): ${
          d.endpoints.filter((e) => e.posture === "healthy").length
        } healthy, ${
          d.endpoints.filter((e) => e.posture !== "healthy").length
        } need attention.</p>`
      : `<p class="meta">No monitored endpoints enrolled yet.</p>`
  }
  ${
    d.training.assigned
      ? `<p class="meta">Security training: ${d.training.completed} of ${d.training.assigned} assignments complete (${pct(
          d.training.completionPct,
        )}).</p>`
      : ""
  }

  <h2>What to focus on next</h2>
  ${openTasksTable(d, 15)}
  <div class="note">This is your current, plain-language snapshot. For a control-by-control compliance breakdown or an insurance/legal report, contact your ShieldAI analyst.</div>`;

  return {
    filename: `ShieldAI_Status_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Security Status Report",
      kicker: "Client Status",
      subtitle: `${d.client.name} · Generated ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.status,
    }),
  };
}

// 2) CLIENT UPDATE — what changed since `sinceIso` (client self-serve)
function buildUpdateReport(d, sinceIso) {
  const since = sinceIso ? new Date(sinceIso) : null;
  const recentActions = (d.actions || [])
    .filter((a) => !since || new Date(a.at) >= since)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const actionRows = recentActions.length
    ? recentActions
        .slice(0, 60)
        .map(
          (a) => `<tr>
        <td>${fmtDate(a.at)}</td>
        <td>${esc(labelActor(a.actorRole))}</td>
        <td>${esc(a.action)}</td>
        <td>${esc(a.detail || "")}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="meta">No recorded activity in this period.</td></tr>`;

  const body = `
  <h2>Summary</h2>
  ${postureBlock(d)}
  <div>
    ${kpi(d.tasks.done, "Completed to date")}
    ${kpi(d.tasks.open, "Still open")}
    ${kpi(d.tasks.overdue, "Overdue")}
  </div>

  <h2>Activity this period${since ? ` (since ${fmtDate(sinceIso)})` : ""}</h2>
  <table class="content">
    <tr><th>Date</th><th>By</th><th>Action</th><th>Detail</th></tr>
    ${actionRows}
  </table>

  <h2>Open items</h2>
  ${openTasksTable(d, 20)}`;

  return {
    filename: `ShieldAI_Update_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Program Update Report",
      kicker: "Client Update",
      subtitle: `${d.client.name} · Generated ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.update,
    }),
  };
}

// 3) COMPLIANCE — framework-by-framework control posture (staff only)
function buildComplianceReport(d) {
  const body = `
  <h2>Assessment basis</h2>
  ${postureBlock(d)}

  <h2>Framework posture</h2>
  ${frameworksTable(d.frameworks)}

  <h2>Audit-readiness of completed work</h2>
  <div>
    ${kpi(d.evidence.completedTasks, "Completed tasks")}
    ${kpi(d.evidence.completedTasksWithEvidence, "With evidence")}
    ${kpi(d.evidence.completedTasksMissingEvidence, "Missing evidence")}
  </div>
  <p class="meta">Completed remediation without attached evidence is the first thing an assessor will question. Closing the "missing evidence" gap is the highest-leverage audit-readiness action.</p>

  <h2>Open remediation items</h2>
  ${openTasksTable(d, 60)}`;

  return {
    filename: `ShieldAI_Compliance_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Compliance Posture Report",
      kicker: "Compliance / Regulatory",
      subtitle: `${d.client.name} · Prepared ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.compliance,
    }),
  };
}

// 4) INSURANCE — attestable-controls subset (staff only)
function buildInsuranceReport(d) {
  // Map posture + endpoint + training + framework signals into the control
  // areas cyber-insurers ask about. We report status honestly; where the data
  // doesn't establish a control, we say "Not established" rather than "No".
  const healthyEndpoints = d.endpoints.filter(
    (e) => e.posture === "healthy",
  ).length;

  const controlRows = [
    [
      "Security assessment on file",
      d.hasAssessment ? "Yes" : "Not established",
      d.hasAssessment
        ? `Assessed ${fmtDate(d.assessedAt)}`
        : "No completed assessment",
    ],
    [
      "Documented security program",
      d.tasks.total > 0 ? "In place" : "Not established",
      `${d.tasks.done} items completed, ${d.tasks.open} open`,
    ],
    [
      "Endpoint monitoring",
      d.endpoints.length ? "Deployed" : "Not established",
      d.endpoints.length
        ? `${healthyEndpoints}/${d.endpoints.length} endpoints healthy`
        : "No monitored endpoints",
    ],
    [
      "Security awareness training",
      d.training.assigned ? "In place" : "Not established",
      d.training.assigned
        ? `${pct(d.training.completionPct)} completion`
        : "No training assigned",
    ],
    [
      "Evidence retention",
      d.evidence.total > 0 ? "Maintained" : "Not established",
      `${d.evidence.total} evidence records on file`,
    ],
  ];

  const rows = controlRows
    .map(
      ([area, status, detail]) => `<tr>
      <td><b>${esc(area)}</b></td>
      <td>${esc(status)}</td>
      <td>${esc(detail)}</td>
    </tr>`,
    )
    .join("");

  const body = `
  <h2>Applicant</h2>
  <p><b>${esc(d.client.name)}</b>${d.client.industry ? ` · ${esc(d.client.industry)}` : ""}</p>
  ${postureBlock(d)}

  <h2>Control summary</h2>
  <p class="meta">The following reflects controls evidenced within ShieldAI as of ${fmtDate(
    d.generatedAt,
  )}. "Not established" means the platform does not hold data establishing the control — it is not an assertion that the control is absent.</p>
  <table class="content">
    <tr><th>Control area</th><th>Status</th><th>Basis</th></tr>
    ${rows}
  </table>

  <h2>Compliance frameworks in scope</h2>
  ${frameworksTable(d.frameworks)}

  <div class="note">Insurers require accurate representations. Verify each line against your own records and review with your broker before submitting any application or renewal.</div>`;

  return {
    filename: `ShieldAI_Insurance_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Cyber-Insurance Readiness Report",
      kicker: "Insurance",
      subtitle: `${d.client.name} · Prepared ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.insurance,
    }),
  };
}

// 5) LEGAL — defensible activity record built on the clientActions trail (staff)
function buildLegalReport(d) {
  const actions = (d.actions || [])
    .slice()
    .sort((a, b) => new Date(a.at) - new Date(b.at)); // chronological for a record

  const rows = actions.length
    ? actions
        .map(
          (a) => `<tr>
        <td>${fmtDate(a.at)}</td>
        <td>${esc(labelActor(a.actorRole))}</td>
        <td>${esc(a.action)}</td>
        <td>${esc(a.detail || "")}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="meta">No recorded actions.</td></tr>`;

  const aiActions = actions.filter((a) => a.actorRole === "ai").length;
  const humanActions = actions.filter((a) =>
    ["client_admin", "analyst", "admin"].includes(a.actorRole),
  ).length;

  const body = `
  <h2>Subject</h2>
  <p><b>${esc(d.client.name)}</b> · ${esc(d.client.email)}</p>
  <p class="meta">Report generated ${fmtDate(d.generatedAt)}. Assessment of record: ${
    d.hasAssessment ? fmtDate(d.assessedAt) : "none on file"
  }.</p>

  <h2>Advisory / action separation</h2>
  <div>
    ${kpi(aiActions, "AI advisory events")}
    ${kpi(humanActions, "Human decisions/actions")}
  </div>
  <p class="meta">ShieldAI's AI produces advisory output only; decisions and actions are recorded against the human or role that took them. This separation is reflected in the "By" column below.</p>

  <h2>Chronological activity record</h2>
  <table class="content">
    <tr><th>Date</th><th>By</th><th>Action</th><th>Detail</th></tr>
    ${rows}
  </table>

  <h2>Current posture &amp; open obligations</h2>
  ${postureBlock(d)}
  ${openTasksTable(d, 60)}`;

  return {
    filename: `ShieldAI_Legal_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Security Program Activity Record",
      kicker: "Legal",
      subtitle: `${d.client.name} · Prepared ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.legal,
    }),
  };
}

// 6) TRAINING — full learner roster, status, and grades (staff-generated,
// suitable for compliance frameworks, insurance applications, and legal
// review of workforce security-awareness obligations).
function buildTrainingReport(d) {
  const t = d.training;

  const summary = `
  <div>
    ${kpi(t.learners, "Learners")}
    ${kpi(t.assigned, "Assignments")}
    ${kpi(pct(t.completionPct), "Completion rate")}
    ${kpi(t.avgScore === null ? "—" : `${t.avgScore}`, "Average score")}
    ${kpi(t.overdue, "Overdue")}
  </div>`;

  const STATUS_LABEL = {
    completed: "Completed", in_progress: "In progress", assigned: "Assigned",
    overdue: "Overdue", waived: "Waived",
  };

  const rosterRows = !t.roster.length
    ? `<tr><td colspan="7" class="meta">No learners are on file for this client yet.</td></tr>`
    : t.roster.map((l) => `<tr>
        <td><b>${esc(l.name)}</b>${l.status === "inactive" ? " <span class=\"meta\">(inactive)</span>" : ""}</td>
        <td>${esc(l.department || "—")}</td>
        <td>${esc(l.assigned)}</td>
        <td>${esc(l.completed)}</td>
        <td>${esc(l.inProgress)}</td>
        <td>${esc(l.overdue)}</td>
        <td>${l.avgScore === null ? "—" : esc(l.avgScore)}</td>
        <td>${fmtDate(l.lastCompletedAt)}</td>
      </tr>`).join("");

  // Per-assignment detail, so an auditor can see WHAT each learner was
  // assigned, not just a rolled-up count. Kept to learners who have at least
  // one assignment, to keep the document a reasonable length.
  const detailBlocks = t.roster
    .filter((l) => l.assignmentTitles.length > 0)
    .map((l) => {
      const rows = l.assignmentTitles.map((a) => `<tr>
          <td>${esc(a.title)}</td>
          <td>${esc(STATUS_LABEL[a.status] || a.status)}</td>
          <td>${a.score === null ? "—" : esc(a.score)}</td>
          <td>${a.dueDate ? fmtDate(a.dueDate) : "—"}</td>
        </tr>`).join("");
      return `
      <h3>${esc(l.name)}${l.department ? ` · ${esc(l.department)}` : ""}</h3>
      <table class="content">
        <tr><th>Assignment</th><th>Status</th><th>Score</th><th>Due date</th></tr>
        ${rows}
      </table>`;
    }).join("");

  const body = `
  <h2>Program summary</h2>
  ${summary}
  <p class="meta">Reflects all learners and training assignments on file for ${esc(d.client.name)} as of ${fmtDate(d.generatedAt)}.</p>

  <h2>Learner roster</h2>
  <table class="content">
    <tr><th>Learner</th><th>Department</th><th>Assigned</th><th>Completed</th><th>In progress</th><th>Overdue</th><th>Avg score</th><th>Last completed</th></tr>
    ${rosterRows}
  </table>

  <h2>Assignment detail</h2>
  ${detailBlocks || `<div class="note">No individual assignments to detail.</div>`}`;

  return {
    filename: `ShieldAI_Training_${slug(d.client.name)}_${dateStamp()}.doc`,
    html: wrapDoc({
      title: "Security Awareness Training Completion Report",
      kicker: "Training / Compliance",
      subtitle: `${d.client.name} · Prepared ${fmtDate(d.generatedAt)}`,
      body,
      disclaimer: DISCLAIMERS.training,
    }),
  };
}

function labelActor(role) {
  return (
    {
      client_admin: "Client",
      analyst: "Analyst",
      admin: "Admin",
      ai: "ShieldAI (advisory)",
      system: "System",
    }[role] || role || "System"
  );
}

function slug(s) {
  return String(s || "Client")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

const BUILDERS = {
  status: (d) => buildStatusReport(d),
  update: (d, opts) => buildUpdateReport(d, opts?.since),
  compliance: (d) => buildComplianceReport(d),
  insurance: (d) => buildInsuranceReport(d),
  legal: (d) => buildLegalReport(d),
  training: (d) => buildTrainingReport(d),
};

const CLIENT_SELF_TYPES = new Set(["status", "update"]);
const STAFF_TYPES = new Set(["compliance", "insurance", "legal", "training"]);
export const REPORT_TYPES = [...CLIENT_SELF_TYPES, ...STAFF_TYPES];

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerReportRoutes(app, {
  db, requireAuth, logClientAction, analystOwnsClient, analystClientIds, gate,
}) {
  db.data.reports ||= []; // { id, clientId, type, title, filename, html, createdBy, createdByRole, createdAt, deliveredAt }

  const uById = (id) => userById(db, id);

  function isStaff(actor) {
    return !!(actor && (actor.isAdmin || actor.isAnalyst));
  }

  // Can `actor` produce/read reports about `clientId`?
  function canAccessClient(actor, clientId) {
    if (!actor) return false;
    if (actor.isAdmin) return true;
    if (actor.id === clientId) return true; // client → own data
    if (actor.isAnalyst && analystOwnsClient)
      return analystOwnsClient(db, actor.id, clientId);
    return false;
  }

  function publicReport(r) {
    // The stored HTML is large; the list view doesn't need it.
    const { html, ...rest } = r;
    return rest;
  }

  // ── Generate a report ──
  // Body: { type, clientId?, since? }
  // Clients may only generate status/update for themselves. Staff may generate
  // any type for a client they're authorized for.
  app.post("/api/reports/generate", requireAuth, gate.capability("reportsAccess"), async (req, res) => {
    const actor = uById(req.userId);
    if (!actor) return res.status(404).json({ error: "User not found." });

    const { type, since } = req.body || {};
    if (!REPORT_TYPES.includes(type)) {
      return res
        .status(400)
        .json({ error: `type must be one of: ${REPORT_TYPES.join(", ")}` });
    }

    // Resolve the target client.
    let clientId = req.body?.clientId;
    if (STAFF_TYPES.has(type)) {
      if (!isStaff(actor)) {
        return res.status(403).json({
          error:
            "Compliance, insurance, and legal reports are produced by ShieldAI staff. Your analyst can prepare and deliver one to you.",
          code: "STAFF_ONLY",
        });
      }
      if (!clientId)
        return res
          .status(400)
          .json({ error: "clientId is required for this report type." });
    } else {
      // client self-serve types default to the requester
      clientId = clientId || actor.id;
      // a client can only target itself; staff may target an assigned client
      if (!isStaff(actor) && clientId !== actor.id) {
        return res.status(403).json({ error: "You can only generate reports about your own account." });
      }
    }

    if (!canAccessClient(actor, clientId)) {
      return res.status(403).json({ error: "Not permitted for this client." });
    }

    const data = gatherReportData(db, clientId);
    if (!data)
      return res.status(404).json({ error: "Client not found." });

    let built;
    try {
      built = BUILDERS[type](data, { since });
    } catch (e) {
      return res
        .status(500)
        .json({ error: `Could not build report: ${e.message}` });
    }

    const record = {
      id: randomUUID(),
      clientId,
      type,
      title: built.filename.replace(/\.doc$/, "").replace(/_/g, " "),
      filename: built.filename,
      html: built.html,
      createdBy: actor.id,
      createdByRole: actor.isAdmin
        ? "admin"
        : actor.isAnalyst
          ? "analyst"
          : "client_admin",
      createdAt: nowIso(),
      // Client-generated reports are immediately visible to that client; staff
      // reports stay undelivered until explicitly delivered.
      deliveredAt: CLIENT_SELF_TYPES.has(type) && actor.id === clientId
        ? nowIso()
        : null,
    };
    db.data.reports.push(record);

    if (logClientAction) {
      logClientAction(db, {
        clientUserId: clientId,
        actorUserId: actor.id,
        actorRole: record.createdByRole,
        action: "generated_report",
        detail: `Generated ${type} report "${record.filename}".`,
      });
    }
    await db.write();

    res.status(201).json(publicReport(record));
  });

  // ── List reports ──
  // Staff: pass ?clientId= to scope to one client; otherwise all authorized.
  // Client: only own delivered reports (and own self-generated ones).
  app.get("/api/reports", requireAuth, gate.capability("reportsAccess"), (req, res) => {
    const actor = uById(req.userId);
    if (!actor) return res.status(404).json({ error: "User not found." });

    let list = db.data.reports || [];

    if (actor.isAdmin) {
      if (req.query.clientId)
        list = list.filter((r) => r.clientId === req.query.clientId);
    } else if (actor.isAnalyst) {
      const ids = analystClientIds ? analystClientIds(db, actor.id) : [];
      const scope = new Set(ids);
      list = list.filter((r) => scope.has(r.clientId));
      if (req.query.clientId) {
        if (!scope.has(req.query.clientId))
          return res.status(403).json({ error: "Not permitted for this client." });
        list = list.filter((r) => r.clientId === req.query.clientId);
      }
    } else {
      // client: own reports that are either self-made or delivered
      list = list.filter(
        (r) => r.clientId === actor.id && (r.deliveredAt || r.createdBy === actor.id),
      );
    }

    list = [...list].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    );
    res.json(list.map(publicReport));
  });

  // ── Deliver a staff report to the client ──
  app.post("/api/reports/:id/deliver", requireAuth, gate.capability("reportsAccess"), async (req, res) => {
    const actor = uById(req.userId);
    if (!isStaff(actor))
      return res.status(403).json({ error: "Only staff can deliver reports." });

    const r = (db.data.reports || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "Report not found." });
    if (!canAccessClient(actor, r.clientId))
      return res.status(403).json({ error: "Not permitted for this client." });

    if (!r.deliveredAt) {
      r.deliveredAt = nowIso();
      if (logClientAction) {
        logClientAction(db, {
          clientUserId: r.clientId,
          actorUserId: actor.id,
          actorRole: actor.isAdmin ? "admin" : "analyst",
          action: "delivered_report",
          detail: `Delivered ${r.type} report "${r.filename}" to the client.`,
        });
      }
      await db.write();
    }
    res.json(publicReport(r));
  });

  // ── Download a report's document ──
  // Returns the branded HTML with a .doc filename so it opens in Word.
  app.get("/api/reports/:id/download", requireAuth, gate.capability("reportsAccess"), (req, res) => {
    const actor = uById(req.userId);
    if (!actor) return res.status(404).json({ error: "User not found." });

    const r = (db.data.reports || []).find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "Report not found." });

    // Staff need client authorization; a client may only download its own
    // reports, and only once delivered (or if it self-generated them).
    if (isStaff(actor)) {
      if (!canAccessClient(actor, r.clientId))
        return res.status(403).json({ error: "Not permitted for this client." });
    } else {
      const ownAndVisible =
        r.clientId === actor.id && (r.deliveredAt || r.createdBy === actor.id);
      if (!ownAndVisible)
        return res.status(403).json({ error: "Not permitted." });
    }

    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${r.filename}"`,
    );
    res.send(r.html);
  });

  // ── Delete a report (staff, or the client for its own self-made report) ──
  // We do NOT hard-delete anything else; this only removes a generated document.
  app.delete("/api/reports/:id", requireAuth, gate.capability("reportsAccess"), async (req, res) => {
    const actor = uById(req.userId);
    const idx = (db.data.reports || []).findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Report not found." });
    const r = db.data.reports[idx];

    const allowed =
      (isStaff(actor) && canAccessClient(actor, r.clientId)) ||
      (r.clientId === actor.id && r.createdBy === actor.id);
    if (!allowed) return res.status(403).json({ error: "Not permitted." });

    db.data.reports.splice(idx, 1);
    await db.write();
    res.json({ ok: true });
  });
}
