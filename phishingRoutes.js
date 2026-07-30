// phishingRoutes.js
// Phishing simulation — send realistic-but-safe test emails to a client's
// enrolled learners, track who clicks, and turn the result into a teaching
// moment (not a gotcha) via the public reveal page.
//
// PRICING (2026-07-25): ongoing campaigns are gated on the same
// `trainingDelivery` capability as the rest of the training product (Growth+
// bundled, Starter add-on) — treated as an extension of employee training
// delivery, not a separate priced thing. BUT every client without
// trainingDelivery gets exactly ONE free trial campaign, sent to up to 3
// ad-hoc recipients (name/email typed directly — no learner enrollment
// required, so it doesn't depend on the also-gated learner CRUD in
// trainingProgramRoutes.js). This is the SMB-competitiveness lever: a
// Starter prospect gets to see "2 of 3 people clicked" once, for real,
// before being asked to pay for ongoing campaigns. See tiers.js for the
// full reasoning.
//
// Reuses the existing `learners` collection from trainingProgramRoutes.js for
// paying customers — a normal campaign targets real enrolled learners. The
// one-time trial campaign instead carries `adHocRecipients` directly on the
// campaign/result rows (see ensureCollections below) so it never touches
// learner enrollment at all.
//
// Requires emailService.js to be configured (RESEND_API_KEY) to actually
// send. Without it, campaign creation still works; /send returns a clear
// "email not configured" error rather than crashing — same graceful-
// degradation pattern as Stripe billing.

import { randomUUID } from "crypto";
import { getScenario, scenarioSummaries, renderScenario } from "./phishingScenarios.js";
import { sendEmail, emailConfigured } from "./emailService.js";
import { hasTrainingDelivery, getTier, priceLabel, getAddon } from "./tiers.js";

function ensureCollections(db) {
  // isTrial: true marks the one free campaign a non-paying client is allowed.
  // adHocRecipients: [{id,name,email}] populated ONLY on a trial campaign —
  // normal campaigns keep targeting real learners via learnerIds.
  db.data.phishingCampaigns ||= []; // { id, clientUserId, name, scenarioId, learnerIds[], adHocRecipients[]?, isTrial, status, createdBy, createdAt, sentAt }
  db.data.phishingResults  ||= []; // { id, campaignId, learnerId?, recipientName?, recipientEmail?, token, sentAt, sendError, clickedAt }
}

// Has this client already used their one free trial campaign?
function hasUsedTrial(db, clientUserId) {
  return (db.data.phishingCampaigns || []).some(c => c.clientUserId === clientUserId && c.isTrial);
}

function upgradeMessage(tier) {
  const addon = getAddon("training_delivery");
  return {
    error: "You've used your one free trial phishing campaign. Add Training Delivery ($40/mo) on your current plan, or upgrade to Growth, for ongoing campaigns.",
    code: "UPGRADE_REQUIRED",
    capability: "trainingDelivery",
    currentTier: tier,
    requiresTier: "growth",
    requiresTierName: getTier("growth").name,
    requiresPrice: priceLabel("growth"),
    addon: "training_delivery",
    addonPrice: addon ? `$${(addon.priceCents / 100).toFixed(0)}/mo` : null,
  };
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
  const targeted = campaign.learnerIds.length + (campaign.adHocRecipients?.length || 0);
  return {
    ...campaign,
    stats: {
      targeted,
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

  // ── Trial eligibility (Starter/Free without trainingDelivery) ────
  // `eligible` means: doesn't already have full delivery AND hasn't used the
  // one free trial yet. Staff acting on behalf of a client see the CLIENT's
  // eligibility, not their own (staff have no tier).
  app.get("/api/phishing/trial-status", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const tier = gate.tierOf(scope.clientUserId);
    const hasFull = hasTrainingDelivery(tier, gate.addonsOf(scope.clientUserId));
    res.json({
      hasFullDelivery: hasFull,
      used: hasUsedTrial(db, scope.clientUserId),
      eligible: !hasFull && !hasUsedTrial(db, scope.clientUserId),
      configured: emailConfigured(),
    });
  });

  // Creating a campaign is real training DELIVERY for paying clients — same
  // capability that gates the rest of the training product. A client WITHOUT
  // that capability gets exactly one exception: a single trial campaign
  // targeting up to 3 directly-typed recipients (no learner enrollment, which
  // is itself gated). Viewing is not gated here since the frontend already
  // only shows the full tab to clients who have the capability; this is the
  // backend's actual enforcement, per tierGate.js's "UI hiding is cosmetic."
  app.post("/api/phishing/campaigns", requireAuth, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const { name, scenarioId, learnerIds, adHocRecipients } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: "Campaign name is required." });
    const scenario = getScenario(scenarioId);
    if (!scenario) return res.status(400).json({ error: "Unknown scenario." });

    const tier = gate.tierOf(scope.clientUserId);
    const hasFull = hasTrainingDelivery(tier, gate.addonsOf(scope.clientUserId));
    const isStaff = scope.role === "admin" || scope.role === "analyst";

    if (hasFull || isStaff) {
      // Normal path: real enrolled learners, unlimited campaigns.
      const ids = Array.isArray(learnerIds) ? learnerIds : [];
      const validLearners = (db.data.learners || []).filter(l =>
        l.clientUserId === scope.clientUserId && ids.includes(l.id) && l.status === "active");
      if (!validLearners.length) return res.status(400).json({ error: "Select at least one active learner." });

      const campaign = {
        id: randomUUID(), clientUserId: scope.clientUserId, name: name.trim(), scenarioId,
        learnerIds: validLearners.map(l => l.id), adHocRecipients: [], isTrial: false, status: "draft",
        createdBy: scope.role, createdAt: new Date().toISOString(), sentAt: null,
      };
      db.data.phishingCampaigns.push(campaign);
      await db.write();
      return res.json(campaignSummary(db, campaign));
    }

    // Trial path — no trainingDelivery, and not staff acting with full access.
    if (hasUsedTrial(db, scope.clientUserId)) {
      return res.status(402).json(upgradeMessage(tier));
    }
    const recipients = Array.isArray(adHocRecipients) ? adHocRecipients : [];
    const cleaned = recipients
      .map(r => ({ id: randomUUID(), name: String(r?.name || "").trim().slice(0, 100), email: String(r?.email || "").trim().slice(0, 200) }))
      .filter(r => r.name && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
    if (!cleaned.length) {
      return res.status(400).json({ error: "Add at least one recipient with a valid name and email for your trial test." });
    }
    if (cleaned.length > 3) {
      return res.status(400).json({ error: "The free trial is limited to 3 recipients. Upgrade for ongoing campaigns with your full team." });
    }

    const campaign = {
      id: randomUUID(), clientUserId: scope.clientUserId, name: name.trim() || "Free trial phishing test", scenarioId,
      learnerIds: [], adHocRecipients: cleaned, isTrial: true, status: "draft",
      createdBy: scope.role, createdAt: new Date().toISOString(), sentAt: null,
    };
    db.data.phishingCampaigns.push(campaign);
    await db.write();
    res.json(campaignSummary(db, campaign));
  });

  app.get("/api/phishing/campaigns/:id", requireAuth, (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    const results = (db.data.phishingResults || []).filter(r => r.campaignId === campaign.id).map(r => {
      const learner = r.learnerId ? (db.data.learners || []).find(l => l.id === r.learnerId) : null;
      return {
        learnerId: r.learnerId || null,
        name: learner?.name || r.recipientName || "(removed)",
        email: learner?.email || r.recipientEmail || "",
        sentAt: r.sentAt, sendError: r.sendError || null, clickedAt: r.clickedAt || null,
      };
    });
    res.json({ ...campaignSummary(db, campaign), results });
  });

  app.delete("/api/phishing/campaigns/:id", requireAuth, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    if (campaign.status !== "draft") return res.status(400).json({ error: "Only draft campaigns can be deleted — a sent campaign's results stay on record." });
    db.data.phishingCampaigns = db.data.phishingCampaigns.filter(c => c.id !== campaign.id);
    db.data.phishingResults = db.data.phishingResults.filter(r => r.campaignId !== campaign.id);
    await db.write();
    res.json({ ok: true });
  });

  // ── Send ───────────────────────────────────────────────────────
  app.post("/api/phishing/campaigns/:id/send", requireAuth, async (req, res) => {
    const scope = resolveClientScope(db, req, { analystOwnsClient });
    if (!scope.ok) return res.status(403).json({ error: scope.error });
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === req.params.id && c.clientUserId === scope.clientUserId);
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    if (campaign.status !== "draft") return res.status(400).json({ error: "This campaign has already been sent." });

    // A trial campaign was already validated (one-per-client, ≤3 recipients)
    // at creation time, so it's always sendable. Staff bypass entirely.
    // Anyone else must currently have trainingDelivery to send.
    const isStaff = scope.role === "admin" || scope.role === "analyst";
    if (!campaign.isTrial && !isStaff) {
      const tier = gate.tierOf(scope.clientUserId);
      if (!hasTrainingDelivery(tier, gate.addonsOf(scope.clientUserId))) {
        return res.status(402).json(upgradeMessage(tier));
      }
    }

    if (!emailConfigured()) {
      return res.status(503).json({ error: "Email sending is not configured. Set RESEND_API_KEY in the server environment — see PHISHING_SIMULATION_SETUP.md." });
    }
    const scenario = getScenario(campaign.scenarioId);
    const learners = (db.data.learners || []).filter(l => campaign.learnerIds.includes(l.id));
    // Unify real learners and ad-hoc trial recipients into one send list.
    const targets = [
      ...learners.map(l => ({ email: l.email, name: l.name, learnerId: l.id })),
      ...(campaign.adHocRecipients || []).map(r => ({ email: r.email, name: r.name, learnerId: null })),
    ];

    campaign.status = "sending";
    await db.write();

    const APP_URL = process.env.APP_URL || "http://localhost:5173";
    for (const target of targets) {
      const token = randomUUID().replace(/-/g, "");
      const link = `${APP_URL}/phish/${token}`;
      const { subject, html, senderName } = renderScenario(scenario, { link });
      const result = await sendEmail({
        to: target.email, subject, html, fromName: senderName, fromLocal: scenario.senderLocal,
      });
      db.data.phishingResults.push({
        id: randomUUID(), campaignId: campaign.id, learnerId: target.learnerId,
        recipientName: target.learnerId ? null : target.name,
        recipientEmail: target.learnerId ? null : target.email,
        token,
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
  app.get("/api/phish/:token", async (req, res) => {
    const result = (db.data.phishingResults || []).find(r => r.token === req.params.token);
    if (!result) return res.status(404).json({ error: "Link not found or expired." });
    if (!result.clickedAt) {
      result.clickedAt = new Date().toISOString();
      await db.write();
    }
    const campaign = (db.data.phishingCampaigns || []).find(c => c.id === result.campaignId);
    const scenario = getScenario(campaign?.scenarioId);
    const learner = result.learnerId ? (db.data.learners || []).find(l => l.id === result.learnerId) : null;
    res.json({
      scenarioName: scenario?.name || "Security Awareness Test",
      redFlags: scenario?.redFlags || [],
      learnerName: learner?.name || result.recipientName || null,
    });
  });

  console.log("ShieldAI phishing simulation routes registered.");
}
