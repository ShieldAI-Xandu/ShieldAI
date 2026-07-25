// phishingRoutes.js
// Phishing simulation — send realistic-but-safe test emails to a client's
// enrolled learners, track who clicks, and turn the result into a teaching
// moment (not a gotcha) via the public reveal page.
//
// Gated on the same `trainingDelivery` capability as the rest of the
// training product (Growth+ bundled, Starter add-on) — this is treated as
// an extension of employee training delivery, not a separate priced thing.
// If that's wrong for how you want to price it, it's a one-line change in
// the gate.trainingDelivery() calls in server.js.
//
// Reuses the existing `learners` collection from trainingProgramRoutes.js —
// a campaign targets real enrolled learners, not a separate contact list.
//
// Requires emailService.js to be configured (RESEND_API_KEY) to actually
// send. Without it, campaign creation still works; /send returns a clear
// "email not configured" error rather than crashing — same graceful-
// degradation pattern as Stripe billing.

import { randomUUID } from "crypto";
import { getScenario, scenarioSummaries, renderScenario } from "./phishingScenarios.js";
import { sendEmail, emailConfigured } from "./emailService.js";

function ensureCollections(db) {
  db.data.phishingCampaigns ||= []; // { id, clientUserId, name, scenarioId, learnerIds[], status, createdBy, createdAt, sentAt }
  db.data.phishingResults  ||= []; // { id, campaignId, learnerId, token, sentAt, sendError, clickedAt }
}

// Mirrors resolveClientScope in trainingProgramRoutes.js exactly — same
// admin/analyst/client-admin scoping rules, kept local to avoid a cross-file
// import cycle for one small helper.
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

function campaignSummary(db, campaign) {
  const results = (db.data.phishingResults || []).filter(r => r.campaignId === campaign.id);
  const sent = results.filter(r => r.sentAt && !r.sendError);
  const failed = results.filter(r => r.sendError);
  const clicked = results.filter(r => r.clickedAt);
  return {
    ...campaign,
    stats: {
      targeted: campaign.learnerIds.length,
      sent: sent.length,
      failed: failed.length,
      clicked: clicked.length,
      clickRatePct: sent.length ? Math.round((clicked.length / sent.length) * 100) : null,
    },
  };
}

/** Per-client rollup for Mastermind / portfolio tooling — mirrors clientTrainingSummary's shape. */
export function clientPhishingSummary(db, clientUserId) {
  const campaigns = (db.data.phishingCampaigns || []).filter(c => c.clientUserId === clientUserId);
  const completed = campaigns.filter(c => c.status === "sent" || c.status === "completed");
  const withStats = completed.map(c => campaignSummary(db, c));
  const totalSent = withStats.reduce((s, c) => s + c.stats.sent, 0);
  const totalClicked = withStats.reduce((s, c) => s + c.stats.clicked, 0);
  return {
    campaignsRun: completed.length,
    overallClickRatePct: totalSent ? Math.round((totalClicked / totalSent) * 100) : null,
    lastCampaignAt: completed.length ? completed.map(c => c.sentAt).sort().slice(-1)[0] : null,
  };
}

/** Portfolio-wide summary for admin/analyst tooling — mirrors trainingSummary's shape. */
export function phishingSummary(db) {
  const clientIds = [...new Set((db.data.phishingCampaigns || []).map(c => c.clientUserId))];
  return clientIds.map(id => ({ clientUserId: id, ...clientPhishingSummary(db, id) }));
}

export function registerPhishingRoutes(app, { db, requireAuth, gate, analystOwnsClient }) {
  ensureCollections(db);

  // ── Scenario catalog ──────────────────────────────────────────
  app.get("/api/phishing/scenarios", requireAuth, (req, res) => {
    res.json(scenarioSummaries());
  });

  // ── Campaigns (client/analyst/admin) ──────────────────────────
  app.get("/api/phishing/campaigns", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaigns = (db.data.phishingCampaigns || [])
      .filter(c => c.clientUserId === scope.clientUserId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(c => campaignSummary(db, c));
    res.json(campaigns);
  });

  app.get("/api/phishing/overview", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    res.json({ configured: emailConfigured(), ...clientPhishingSummary(db, scope.clientUserId) });
  });

  // Creating and sending a campaign is real training DELIVERY — the same
  // capability that gates the rest of the training product. Viewing is not
  // gated here since the frontend already only shows this tab to clients
  // who have the capability; this is the backend's actual enforcement for
  // the two actions that matter, per tierGate.js's own "UI hiding is
  // cosmetic" principle.
  app.post("/api/phishing/campaigns", requireAuth, gate.trainingDelivery(), (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const { name, scenarioId, learnerIds } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "Campaign name is required." });
    const scenario = getScenario(scenarioId);
    if (!scenario) return res.status(400).json({ error: "Unknown scenario." });
    const ids = Array.isArray(learnerIds) ? learnerIds : [];
    const validLearners = (db.data.learners || []).filter(l =>
      l.clientUserId === scope.clientUserId && ids.includes(l.id) && l.status === "active");
    if (!validLearners.length) return res.status(400).json({ error: "Select at least one active learner." });

    const campaign = {
      id: randomUUID(), clientUserId: scope.clientUserId, name: name.trim(), scenarioId,
      learnerIds: validLearners.map(l => l.id), status: "draft",
      createdBy: scope.role, createdAt: new Date().toISOString(), sentAt: null,
    };
    db.data.phishingCampaigns.push(campaign);
    db.write();
    res.json(campaignSummary(db, campaign));
  });

  app.get("/api/phishing/campaigns/:id", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    const results = (db.data.phishingResults || []).filter(r => r.campaignId === campaign.id).map(r => {
      const learner = (db.data.learners || []).find(l => l.id === r.learnerId);
      return { learnerId: r.learnerId, name: learner?.name || "(removed)", email: learner?.email || "",
        sentAt: r.sentAt, sendError: r.sendError || null, clickedAt: r.clickedAt || null };
    });
    res.json({ ...campaignSummary(db, campaign), results });
  });

  app.delete("/api/phishing/campaigns/:id", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    if (campaign.status !== "draft") return res.status(400).json({ error: "Only draft campaigns can be deleted — a sent campaign's results stay on record." });
    db.data.phishingCampaigns = db.data.phishingCampaigns.filter(c => c.id !== campaign.id);
    db.data.phishingResults = db.data.phishingResults.filter(r => r.campaignId !== campaign.id);
    db.write();
    res.json({ ok: true });
  });

  // ── Send ───────────────────────────────────────────────────────
  app.post("/api/phishing/campaigns/:id/send", requireAuth, gate.trainingDelivery(), async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    if (campaign.status !== "draft") return res.status(400).json({ error: "This campaign has already been sent." });
    if (!emailConfigured()) {
      return res.status(503).json({ error: "Email sending is not configured. Set RESEND_API_KEY in the server environment — see PHISHING_SIMULATION_SETUP.md." });
    }
    const scenario = getScenario(campaign.scenarioId);
    const learners = (db.data.learners || []).filter(l => campaign.learnerIds.includes(l.id));

    campaign.status = "sending";
    await db.write();

    const APP_URL = process.env.APP_URL || "http://localhost:5173";
    for (const learner of learners) {
      const token = randomUUID().replace(/-/g, "");
      const link = `${APP_URL}/phish/${token}`;
      const { subject, html, senderName } = renderScenario(scenario, { link });
      const result = await sendEmail({
        to: learner.email, subject, html, fromName: senderName, fromLocal: scenario.senderLocal,
      });
      db.data.phishingResults.push({
        id: randomUUID(), campaignId: campaign.id, learnerId: learner.id, token,
        sentAt: result.ok ? new Date().toISOString() : null,
        sendError: result.ok ? null : result.error,
        clickedAt: null,
      });
    }
    campaign.status = "sent";
    campaign.sentAt = new Date().toISOString();
    await db.write();
    res.json(campaignSummary(db, campaign));
  });

  // ── Public click-tracking + reveal (no auth — reached from an inbox) ────
  // Idempotent: visiting twice only records the first click. Returns the
  // scenario's red flags so the frontend reveal page can show what to have
  // noticed in THIS specific email, not a generic list.
  app.get("/api/phish/:token", (req, res) => {
    const result = (db.data.phishingResults || []).find(r => r.token === req.params.token);
    if (!result) return res.status(404).json({ error: "Link not found or expired." });
    if (!result.clickedAt) {
      result.clickedAt = new Date().toISOString();
      db.write();
    }
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === result.campaignId);
    const scenario = getScenario(campaign?.scenarioId);
    const learner = (db.data.learners || []).find(l => l.id === result.learnerId);
    res.json({
      scenarioName: scenario?.name || "Security Awareness Test",
      redFlags: scenario?.redFlags || [],
      learnerName: learner?.name || null,
    });
  });

  console.log("ShieldAI phishing simulation routes registered.");
}
