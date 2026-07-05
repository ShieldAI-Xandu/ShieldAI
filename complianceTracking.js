// complianceTracking.js
// Per-client, per-control compliance status for frameworks — the data layer
// behind the interactive "click a framework → see every control's status →
// click a control → get compliance level + remediation" workflow.
//
// STATUS MODEL (hybrid, honest by design):
//  - Some controls are AGENT-VERIFIABLE: the monitoring agent measures the real
//    state (firewall on, disk encryption on, patching current, etc.). For those
//    we auto-fill status from measured data and mark source "agent".
//  - Everything else is CLIENT-ATTESTED: the client marks met/partial/not_met
//    themselves (source "client"). Software cannot know these from the outside,
//    so we never guess — an unattested control is honestly "unknown".
//  Remediation guidance is AI-generated ON DEMAND and grounded in the specific
//  control's real text — it advises how to comply; it never sets the status.

import { randomUUID } from "crypto";
import { getFramework, frameworkKey } from "./customFrameworks.js";

export const STATUS = ["met", "partial", "not_met", "unknown"];

// Map of agent check-id (and CIS control number) -> a matcher that decides if a
// framework control is about the same thing, plus how to read the agent status.
// Agent check ids come from the collectors: firewall, av_realtime, disk
// encryption, patches, local_admins, screen_lock, etc.
const AGENT_SIGNALS = [
  { keywords: ["firewall"],                     checkIds: ["firewall"] },
  { keywords: ["encrypt", "bitlocker", "filevault", "at rest"], checkIds: ["disk_encryption", "diskEncryption", "encryption"] },
  { keywords: ["antivirus", "anti-virus", "malware", "endpoint protection", "defender"], checkIds: ["av_realtime", "av"] },
  { keywords: ["patch", "update", "vulnerabilit"], checkIds: ["patches"] },
  { keywords: ["admin", "privilege", "least privilege"], checkIds: ["local_admins"] },
  { keywords: ["screen lock", "session lock", "auto-lock", "timeout", "inactivity"], checkIds: ["screen_lock"] },
];

// Convert an agent check status (pass/warn/fail) to a compliance status.
function checkToStatus(s) {
  if (s === "pass") return "met";
  if (s === "warn") return "partial";
  if (s === "fail") return "not_met";
  return "unknown";
}

// Latest agent checks for a user, flattened across their agents.
function latestAgentChecks(db, userId) {
  const reports = (db.data.agentReports || []).filter(r => r.ownerUserId === userId);
  const latestByAgent = {};
  for (const r of reports) {
    const cur = latestByAgent[r.agentId];
    if (!cur || new Date(r.receivedAt) > new Date(cur.receivedAt)) latestByAgent[r.agentId] = r;
  }
  const checks = [];
  for (const r of Object.values(latestByAgent)) {
    for (const c of (r.report?.checks || [])) checks.push(c);
  }
  return checks;
}

// Given a control and the client's latest agent checks, return an agent-derived
// status if this control is agent-verifiable and we have data — else null.
function agentStatusForControl(control, agentChecks) {
  if (!agentChecks.length) return null;
  const text = `${control.title || ""} ${control.description || ""} ${control.category || ""}`.toLowerCase();
  for (const sig of AGENT_SIGNALS) {
    if (!sig.keywords.some(k => text.includes(k))) continue;
    // Find a matching check by id.
    const check = agentChecks.find(c => sig.checkIds.includes(c.id));
    if (check) return { status: checkToStatus(check.status), detail: check.detail || check.observed || "", checkId: check.id };
  }
  return null;
}

// storage key
function ck(userId, frameworkId, controlId) { return `${userId}:${frameworkId}:${controlId}`; }

// Return the full framework with each control annotated with its current status
// (agent-measured where possible, else client-attested, else unknown) + a
// rollup summary. This powers the "list all items and their status" view.
export function frameworkStatusForClient(db, userId, frameworkIdOrName) {
  const fw = getFramework(db, frameworkIdOrName);
  if (!fw) return null;
  db.data.controlStatus ||= {};
  const agentChecks = latestAgentChecks(db, userId);

  const controls = (fw.controls || []).map(control => {
    const stored = db.data.controlStatus[ck(userId, fw.id, control.id)];
    const agentDerived = agentStatusForControl(control, agentChecks);

    let status, source, note, updatedAt;
    if (agentDerived) {
      // Measured data wins — it's real, not attested. But if the client has
      // explicitly attested a DIFFERENT status more recently, respect the human
      // (they may have context the agent can't see); flag the disagreement.
      status = agentDerived.status; source = "agent"; note = agentDerived.detail;
      if (stored && stored.source === "client" && stored.status !== agentDerived.status) {
        source = "client"; status = stored.status; note = stored.note;
        return { ...control, status, source, note, agentSuggests: agentDerived.status, updatedAt: stored.updatedAt };
      }
    } else if (stored) {
      status = stored.status; source = "client"; note = stored.note; updatedAt = stored.updatedAt;
    } else {
      status = "unknown"; source = "unset"; note = "";
    }
    return { ...control, status, source, note, updatedAt };
  });

  const counts = controls.reduce((m, c) => { m[c.status] = (m[c.status] || 0) + 1; return m; }, {});
  const total = controls.length;
  const met = counts.met || 0;
  const compliancePct = total ? Math.round((met / total) * 100) : 0;

  return {
    id: fw.id, name: fw.name, description: fw.description,
    controls, counts, total, compliancePct,
  };
}

// Client attests a control's status (met/partial/not_met/unknown) + optional note.
export async function setControlStatus(db, userId, frameworkIdOrName, controlId, status, note) {
  const fw = getFramework(db, frameworkIdOrName);
  if (!fw) throw new Error("Framework not found.");
  if (!STATUS.includes(status)) throw new Error(`Invalid status. Use one of: ${STATUS.join(", ")}`);
  const control = (fw.controls || []).find(c => c.id === controlId);
  if (!control) throw new Error("Control not found in this framework.");

  db.data.controlStatus ||= {};
  db.data.controlStatus[ck(userId, fw.id, controlId)] = {
    status, source: "client", note: String(note || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  await db.write();
  return { frameworkId: fw.id, controlId, status, source: "client" };
}

// Build the prompt for on-demand remediation for a single control.
export function remediationPrompt(fw, control, currentStatus, clientContext) {
  return {
    system: `You are a compliance advisor helping a small business meet a specific security control. Return ONLY valid JSON, no markdown fences:
{"summary":"1-2 sentences on what this control requires and why it matters","steps":[{"action":"specific action to take","how":"concrete how-to for a small business, realistic for limited budget/staff","effort":"Low|Medium|High"}],"evidence":"what to keep as proof of compliance for an auditor","commonPitfalls":"1 sentence"}
Give 3-5 concrete, realistic steps. Ground everything in THIS control and THIS business. Do not invent product names, prices, or standards. Do not claim the control is met — only advise how to meet it. Keep advice practical for a small business.`,
    user: `Framework: ${fw.name}
Control [${control.id}]: ${control.title}${control.category ? ` (category: ${control.category})` : ""}${control.description ? `\nControl detail: ${control.description}` : ""}
Current status: ${currentStatus}
${clientContext ? `Business context: ${clientContext}` : ""}

Generate specific remediation guidance to bring this control into compliance.`,
  };
}

export function registerComplianceTrackingRoutes(app, { db, requireAuth, callClaudeText, extractJson, analystOwnsClient }) {
  // Resolve which user we're acting for (self, or staff viewing a client).
  function resolveTarget(req, res) {
    let targetId = req.userId;
    const wantId = req.query.userId || req.body?.userId;
    if (wantId && wantId !== req.userId) {
      const isStaff = req.isAdmin || req.isAnalyst;
      if (!isStaff) { res.status(403).json({ error: "Not permitted." }); return null; }
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, wantId)) {
        res.status(403).json({ error: "This client is not assigned to you." }); return null;
      }
      targetId = wantId;
    }
    return targetId;
  }

  // Framework with every control's current status + rollup.
  app.get("/api/compliance/:frameworkId/status", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res); if (!targetId) return;
    const result = frameworkStatusForClient(db, targetId, req.params.frameworkId);
    if (!result) return res.status(404).json({ error: "Framework not found." });
    res.json(result);
  });

  // Client attests a control's status.
  app.post("/api/compliance/:frameworkId/control/:controlId/status", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res); if (!targetId) return;
    try {
      const { status, note } = req.body || {};
      const out = await setControlStatus(db, targetId, req.params.frameworkId, req.params.controlId, status, note);
      res.json(out);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // On-demand remediation guidance for one control (live AI, grounded).
  app.post("/api/compliance/:frameworkId/control/:controlId/remediation", requireAuth, async (req, res) => {
    if (!callClaudeText) return res.status(503).json({ error: "AI backend not configured." });
    const targetId = resolveTarget(req, res); if (!targetId) return;

    const fw = getFramework(db, req.params.frameworkId);
    if (!fw) return res.status(404).json({ error: "Framework not found." });
    const control = (fw.controls || []).find(c => c.id === req.params.controlId);
    if (!control) return res.status(404).json({ error: "Control not found." });

    // Current status (from the annotated view) so the advice fits the situation.
    const view = frameworkStatusForClient(db, targetId, fw.id);
    const annotated = view.controls.find(c => c.id === control.id);
    const currentStatus = annotated ? annotated.status : "unknown";

    // Light business context from the latest assessment (kept short).
    const assessments = (db.data.assessments || []).filter(a => a.userId === targetId);
    const latest = assessments[assessments.length - 1];
    const company = latest?.data?.company || latest?.company || {};
    const clientContext = [company.name, company.industry, company.size]
      .filter(Boolean).join(", ");

    const { system, user } = remediationPrompt(fw, control, currentStatus, clientContext);
    try {
      const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 1400 });
      const parsed = extractJson(text);
      res.json({ control: { id: control.id, title: control.title }, currentStatus, remediation: parsed });
    } catch (e) {
      res.status(500).json({ error: "Could not generate remediation guidance.", detail: e.message });
    }
  });
}
