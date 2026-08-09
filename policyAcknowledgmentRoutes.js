// policyAcknowledgmentRoutes.js
// Policy acknowledgment & sign-off tracking — gap #4 from the 2026-07-25 audit.
// ShieldAI generates real policy documents (policyCatalog.js / policyDocs),
// but until now there was no way to prove an employee actually read one. This
// turns a generated policy from "a document that exists" into "provable
// compliance" — exactly what an insurer, auditor, or plaintiff's attorney
// asks about after an incident.
//
// Deliberately reuses the SAME employee roster (`db.data.learners`) and the
// SAME public tokenized link (`/train/:token`) as the training product,
// rather than inventing a second "who works here" list. `employeeRoster`
// (tiers.js) is the capability that gates this — see trainingProgramRoutes.js
// for why roster CRUD was split out from paid training DELIVERY. Assigning a
// policy for acknowledgment has zero AI/send cost (unlike a phishing
// campaign), so it's included from Starter up, same as the roster itself.
//
// Mount from server.js:
//   import { registerPolicyAcknowledgmentRoutes } from "./policyAcknowledgmentRoutes.js";
//   registerPolicyAcknowledgmentRoutes(app, { db, requireAuth, requireAdmin,
//     logClientAction, analystOwnsClient, gate });

import { randomUUID } from "crypto";
import { sendEmail, emailConfigured } from "./emailService.js";
import { notify } from "./notificationDispatch.js";

const nowIso = () => new Date().toISOString();

function ensureCollections(db) {
  // One row per (policyId, learnerId) assignment. Kept even after
  // acknowledgment (acknowledgedAt set) as the actual proof record — this
  // collection IS the audit trail for this feature, not just working state.
  db.data.policyAcknowledgments ||= [];
  // { id, clientUserId, policyId, policyName, learnerId, learnerName,
  //   learnerEmail, assignedAt, assignedBy, assignedByRole, remindedAt,
  //   acknowledgedAt }
}

// Same contract as trainingProgramRoutes.js's resolveClientScope — duplicated
// locally (each feature route file in this codebase owns its own copy; see
// domainRoutes.js/vendorRoutes.js/phishingRoutes.js for the same pattern) so
// this file has no import-time dependency on training internals.
function resolveClientScope(db, req, { analystOwnsClient }) {
  const me = (db.data.users || []).find(u => u.id === req.userId);
  const isAdmin = !!me?.isAdmin;
  const isAnalyst = !!me?.isAnalyst;
  const requested = req.query.clientId || req.body?.clientId;

  if (isAdmin) return { clientUserId: requested || req.userId, role: "admin", ok: true };
  if (isAnalyst) {
    if (!requested) return { ok: false, error: "clientId is required for analyst access." };
    if (!analystOwnsClient(db, req.userId, requested)) return { ok: false, error: "Not assigned to that client." };
    return { clientUserId: requested, role: "analyst", ok: true };
  }
  return { clientUserId: req.userId, role: "client_admin", ok: true };
}

function learnerByToken(db, token) {
  return (db.data.learners || []).find(l => l.token === token) || null;
}

// Per-policy assignment summary — powers the "3 of 8 acknowledged" badge in
// the Policy Library without the frontend needing to compute it itself.
function summarizeByPolicy(rows) {
  const byPolicy = new Map();
  for (const r of rows) {
    if (!byPolicy.has(r.policyId)) byPolicy.set(r.policyId, { policyId: r.policyId, policyName: r.policyName, assigned: 0, acknowledged: 0, pending: 0 });
    const b = byPolicy.get(r.policyId);
    b.assigned++;
    if (r.acknowledgedAt) b.acknowledged++; else b.pending++;
  }
  return [...byPolicy.values()];
}

export function registerPolicyAcknowledgmentRoutes(app, { db, requireAuth, requireAdmin, logClientAction, analystOwnsClient, gate }) {
  ensureCollections(db);

  const gateRoster = (gate && gate.capability) ? gate.capability("employeeRoster") : (req, res, next) => next();

  // ── Client: list all acknowledgment rows + per-policy summary ───
  app.get("/api/client/policies/acknowledgments", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const rows = (db.data.policyAcknowledgments || []).filter(r => r.clientUserId === scope.clientUserId);
    res.json({
      rows: rows.sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt)),
      byPolicy: summarizeByPolicy(rows),
    });
  });

  // ── Client: assign a generated policy to one or more roster members ──
  app.post("/api/client/policies/:policyId/assign", requireAuth, gateRoster, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });

    const policy = (db.data.policyDocs || []).find(p => p.id === req.params.policyId && p.userId === scope.clientUserId);
    if (!policy) return res.status(404).json({ error: "Policy not found." });

    const ids = Array.isArray(req.body?.learnerIds) ? req.body.learnerIds : [];
    const learners = (db.data.learners || []).filter(l =>
      l.clientUserId === scope.clientUserId && ids.includes(l.id) && l.status === "active");
    if (!learners.length) return res.status(400).json({ error: "Select at least one active team member." });

    const existingPending = new Set(
      (db.data.policyAcknowledgments || [])
        .filter(r => r.clientUserId === scope.clientUserId && r.policyId === policy.id && !r.acknowledgedAt)
        .map(r => r.learnerId));

    const created = [];
    for (const learner of learners) {
      if (existingPending.has(learner.id)) continue; // already awaiting their sign-off — don't spam a duplicate row
      const row = {
        id: randomUUID(), clientUserId: scope.clientUserId,
        policyId: policy.id, policyName: policy.policyName,
        learnerId: learner.id, learnerName: learner.name, learnerEmail: learner.email,
        assignedAt: nowIso(), assignedBy: req.userId, assignedByRole: scope.role,
        remindedAt: null, acknowledgedAt: null,
      };
      db.data.policyAcknowledgments.push(row);
      created.push(row);
    }
    await db.write();
    logClientAction(db, { clientUserId: scope.clientUserId, actorUserId: req.userId, actorRole: scope.role,
      action: "policy_assigned_for_acknowledgment",
      detail: `Assigned "${policy.policyName}" to ${created.length} team member(s).` });
    if (created.length > 0) {
      await notify(db, {
        ownerUserId: scope.clientUserId, event: "policy.signoff_pending",
        title: `"${policy.policyName}" assigned for sign-off`,
        detail: `${created.length} team member(s) need to acknowledge this policy.`,
        severity: "info", actionable: false,
      });
    }
    res.json({ ok: true, assigned: created.length, skipped: learners.length - created.length, rows: created });
  });

  // ── Client: unassign one acknowledgment row ──────────────────
  app.delete("/api/client/policies/acknowledgments/:id", requireAuth, gateRoster, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const before = (db.data.policyAcknowledgments || []).length;
    db.data.policyAcknowledgments = (db.data.policyAcknowledgments || [])
      .filter(r => !(r.id === req.params.id && r.clientUserId === scope.clientUserId));
    if ((db.data.policyAcknowledgments || []).length === before) return res.status(404).json({ error: "Not found." });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // ── Client: send a real reminder email to a pending signer ───
  app.post("/api/client/policies/acknowledgments/:id/remind", requireAuth, gateRoster, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const row = (db.data.policyAcknowledgments || []).find(r => r.id === req.params.id && r.clientUserId === scope.clientUserId);
    if (!row) return res.status(404).json({ error: "Not found." });
    if (row.acknowledgedAt) return res.status(400).json({ error: "This was already acknowledged." });

    const learner = (db.data.learners || []).find(l => l.id === row.learnerId);
    if (!learner) return res.status(404).json({ error: "That team member no longer exists." });

    row.remindedAt = nowIso();
    await db.write();

    if (!emailConfigured()) {
      // Still a success from the client's point of view — the link is
      // recorded either way; email is a convenience on top of it.
      return res.json({ ok: true, emailed: false, learnerLink: `/train/${learner.token}`, remindedAt: row.remindedAt });
    }
    const link = `${process.env.APP_URL || "http://localhost:5173"}/train/${learner.token}`;
    const html = `<p>Hi ${learner.name.split(" ")[0]},</p>
<p>You have a company policy waiting for your review: <strong>${row.policyName}</strong>.</p>
<p>Please take a moment to read it and confirm you've reviewed it:</p>
<p><a href="${link}">${link}</a></p>
<p>Thanks,<br/>Your security team</p>`;
    const result = await sendEmail({ to: learner.email, subject: `Please review: ${row.policyName}`, html, fromLocal: "notifications" });
    res.json({ ok: true, emailed: result.ok, sendError: result.ok ? null : result.error, learnerLink: `/train/${learner.token}`, remindedAt: row.remindedAt });
  });

  // ── Public (token-based, no login): the learner's policy list ────
  app.get("/api/train/:token/policies", (req, res) => {
    const learner = learnerByToken(db, req.params.token);
    if (!learner) return res.status(404).json({ error: "This link isn't valid." });
    if (learner.status !== "active") return res.status(403).json({ error: "This account is inactive." });
    const rows = (db.data.policyAcknowledgments || []).filter(r => r.learnerId === learner.id);
    res.json({
      learnerName: learner.name,
      policies: rows
        .sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
        .map(r => ({ id: r.id, policyName: r.policyName, assignedAt: r.assignedAt, acknowledgedAt: r.acknowledgedAt })),
    });
  });

  // ── Public: full policy text for one assignment (to actually read it) ──
  app.get("/api/train/:token/policies/:id", (req, res) => {
    const learner = learnerByToken(db, req.params.token);
    if (!learner) return res.status(404).json({ error: "This link isn't valid." });
    const row = (db.data.policyAcknowledgments || []).find(r => r.id === req.params.id && r.learnerId === learner.id);
    if (!row) return res.status(404).json({ error: "Not found." });
    const doc = (db.data.policyDocs || []).find(p => p.id === row.policyId);
    res.json({
      id: row.id, policyName: row.policyName, assignedAt: row.assignedAt, acknowledgedAt: row.acknowledgedAt,
      content: doc?.content || "This policy's full text is no longer available — please contact your employer.",
    });
  });

  // ── Public: mark it acknowledged ─────────────────────────────
  app.post("/api/train/:token/policies/:id/acknowledge", async (req, res) => {
    const learner = learnerByToken(db, req.params.token);
    if (!learner) return res.status(404).json({ error: "This link isn't valid." });
    if (learner.status !== "active") return res.status(403).json({ error: "This account is inactive." });
    const row = (db.data.policyAcknowledgments || []).find(r => r.id === req.params.id && r.learnerId === learner.id);
    if (!row) return res.status(404).json({ error: "Not found." });
    if (!req.body?.confirmed) return res.status(400).json({ error: "Please confirm you've read the policy first." });
    if (!row.acknowledgedAt) {
      row.acknowledgedAt = nowIso();
      await db.write();
      logClientAction(db, { clientUserId: row.clientUserId, actorUserId: null, actorRole: "learner",
        action: "policy_acknowledged", detail: `${learner.name} acknowledged "${row.policyName}".` });
    }
    res.json({ ok: true, id: row.id, acknowledgedAt: row.acknowledgedAt });
  });

  console.log("ShieldAI policy-acknowledgment routes registered.");
}
