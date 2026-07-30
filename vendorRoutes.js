// vendorRoutes.js
// Vendor & third-party risk MANAGEMENT — gap #3 from the 2026-07-25 audit
// ("vendor risk is assessed once, not managed"). Gives clients an ongoing
// registry with computed reassessment due-dates (instead of a one-time
// checklist snapshot), and an AI-assisted — but strictly fact-grounded —
// assistant for responding to security questionnaires their OWN customers
// send them.
//
// TWO SEPARATE CAPABILITIES (2026-07-25 pricing pass — do not re-merge):
//   - `vendorRegistry` (Starter+, capped via limits.vendors): add/edit/reassess/
//     delete a vendor. Near-zero marginal cost (a DB record), so it's included
//     starting at Starter — keeps the entry tier feeling like a complete
//     program instead of a locked demo.
//   - `vendorQuestionnaireAssistant` (Growth+): the AI-drafted responses to an
//     incoming customer questionnaire. Real per-call AI cost, and the sharper
//     upsell moment — a Starter client's first real incoming questionnaire is
//     exactly when they'll feel this paywall and understand the value of
//     Growth. See tiers.js for the full reasoning.
//
// Follows the same shape as domainRoutes.js: a resolveTarget() helper so
// staff can act on behalf of an assigned client via ?userId=/body.userId,
// and an audit-log entry whenever staff touch a client's data on their
// behalf.

import { randomUUID } from "crypto";
import { getTier } from "./tiers.js";
import {
  VENDOR_CATEGORIES,
  CRITICALITY_LEVELS,
  DATA_ACCESS_LEVELS,
  dueStatus,
  listVendors,
  createVendor,
  updateVendor,
  markReassessed,
  deleteVendor,
  vendorSummary,
  portfolioOverdueQueue,
  buildGroundingFacts,
} from "./vendorRiskService.js";

const nowIso = () => new Date().toISOString();

function audit(db, req, action, targetUserId, detail) {
  db.data.adminAudit ||= [];
  db.data.adminAudit.push({
    id: randomUUID(),
    actorUserId: req.userId,
    actorEmail: req.userEmail || "",
    action,
    targetUserId: targetUserId || null,
    detail: detail || "",
    at: nowIso(),
  });
}

// Resolve which client a request is acting on, enforcing analyst scope —
// identical contract to domainRoutes.js's resolveTarget.
function resolveTarget(req, res, db, analystOwnsClient, id) {
  if (!id || id === req.userId) return req.userId;
  if (!req.isAdmin && !req.isAnalyst) {
    res.status(403).json({ error: "Not permitted." });
    return null;
  }
  if (req.isAnalyst && !req.isAdmin && analystOwnsClient && !analystOwnsClient(db, req.userId, id)) {
    res.status(403).json({ error: "This client is not assigned to you." });
    return null;
  }
  return id;
}

// Counts toward the plan's vendor-registry cap — offboarding a vendor frees
// its slot, same spirit as endpoint/policy counters elsewhere in the product.
function countActiveVendors(db, userId) {
  return (db.data.vendors || []).filter(v => v.userId === userId && v.status !== "offboarded").length;
}

export function registerVendorRoutes(app, { db, requireAuth, requireAdmin, gate, analystOwnsClient, analystClientIds, callClaudeText, extractJson, aiLimiter }) {
  db.data.vendors ||= [];
  db.data.vendorQuestionnaires ||= [];

  // ── Client: list vendors + summary + form metadata ──────────
  app.get("/api/client/vendors", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const tier = gate.tierOf(targetId);
    res.json({
      userId: targetId,
      vendors: listVendors(db, targetId),
      summary: vendorSummary(db, targetId),
      meta: { categories: VENDOR_CATEGORIES, criticalityLevels: CRITICALITY_LEVELS, dataAccessLevels: DATA_ACCESS_LEVELS },
      limits: { vendors: getTier(tier).limits?.vendors ?? null },
    });
  });

  // ── Client: add a vendor ─────────────────────────────────────
  app.post("/api/client/vendors", requireAuth, gate.capability("vendorRegistry"), gate.limit("vendors", countActiveVendors), async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    try {
      const input = { ...(req.body || {}) };
      delete input.userId;
      if (targetId !== req.userId) input.createdByStaff = req.userId;
      const v = createVendor(db, targetId, input);
      if (targetId !== req.userId) audit(db, req, "vendor_added_for_client", targetId, v.name);
      await db.write();
      res.json({ ...v, reviewStatus: dueStatus(v.nextReassessmentDue) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not add that vendor." });
    }
  });

  // ── Client: update a vendor ──────────────────────────────────
  app.patch("/api/client/vendors/:id", requireAuth, gate.capability("vendorRegistry"), async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    try {
      const v = updateVendor(db, targetId, req.params.id, req.body || {});
      await db.write();
      res.json({ ...v, reviewStatus: dueStatus(v.nextReassessmentDue) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not update that vendor." });
    }
  });

  // ── Client: mark a vendor as reassessed today ────────────────
  app.post("/api/client/vendors/:id/reassess", requireAuth, gate.capability("vendorRegistry"), async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;
    try {
      const v = markReassessed(db, targetId, req.params.id, { note: req.body?.note, assessedAt: req.body?.assessedAt });
      if (targetId !== req.userId) audit(db, req, "vendor_reassessed_for_client", targetId, v.name);
      await db.write();
      res.json({ ...v, reviewStatus: dueStatus(v.nextReassessmentDue) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not mark that vendor reassessed." });
    }
  });

  // ── Client: remove a vendor ──────────────────────────────────
  app.delete("/api/client/vendors/:id", requireAuth, gate.capability("vendorRegistry"), async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const ok = deleteVendor(db, targetId, req.params.id);
    if (!ok) return res.status(404).json({ error: "Vendor not found." });
    if (targetId !== req.userId) audit(db, req, "vendor_removed_for_client", targetId, req.params.id);
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // ── Client: AI-assisted incoming-questionnaire responder ─────
  // Drafts answers to a security questionnaire a client's OWN customer sent
  // them, grounded ONLY in verified facts about their real program (see
  // buildGroundingFacts). Anything not covered by those facts comes back
  // flagged needsHumanInput rather than invented — the same no-fabrication
  // rule the rest of the product follows.
  app.post("/api/client/vendors/questionnaire/generate", requireAuth, gate.capability("vendorQuestionnaireAssistant"), aiLimiter, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;

    const questionnaireText = String(req.body?.questionnaireText || "").trim();
    if (!questionnaireText) return res.status(400).json({ error: "Paste the questionnaire text first." });
    if (questionnaireText.length > 12000) {
      return res.status(400).json({ error: "That's too long — paste up to about 12,000 characters, or just the relevant section." });
    }

    try {
      const facts = buildGroundingFacts(db, targetId);
      const factsBlock = facts.map((f, i) => `${i + 1}. ${f}`).join("\n");

      const system = `You are helping a small-business owner draft responses to a security questionnaire sent by one of THEIR customers or business partners. You are given a fixed list of VERIFIED FACTS about this business's actual security program below — nothing else about their security posture is known to be true, and you must not assume otherwise.

Rules, followed strictly:
- Answer each question using ONLY the verified facts below. Do not estimate, assume, or invent anything not stated in them.
- If a question cannot be answered from the verified facts, set "needsHumanInput": true and write a one-sentence "note" telling the owner exactly what to go check or decide internally — never guess at an answer instead.
- Keep each "answer" to 1-3 plain-English sentences suitable for pasting directly into a customer's questionnaire form.
- Split the incoming text into individual questions as best you can; preserve existing numbering/bullets where present.

VERIFIED FACTS:
${factsBlock}

Return ONLY valid, minified JSON — no markdown fences, no commentary — in exactly this shape:
{"answers":[{"question":"","answer":"","needsHumanInput":false,"note":""}]}`;

      const text = await callClaudeText({
        system,
        messages: [{ role: "user", content: `Incoming questionnaire text:\n\n${questionnaireText}` }],
        max_tokens: 3000,
      });
      const parsed = extractJson(text);
      const answers = Array.isArray(parsed?.answers) ? parsed.answers : [];

      const record = {
        id: randomUUID(),
        userId: targetId,
        createdAt: nowIso(),
        questionnaireText: questionnaireText.slice(0, 12000),
        answers,
        factsUsed: facts,
        generatedByStaff: targetId !== req.userId ? req.userId : null,
      };
      db.data.vendorQuestionnaires.push(record);
      if (targetId !== req.userId) audit(db, req, "questionnaire_drafted_for_client", targetId, `${answers.length} question(s)`);
      await db.write();
      res.json(record);
    } catch (err) {
      console.error("Vendor questionnaire generation error:", err.message);
      res.status(500).json({ error: "Could not draft responses right now. Please try again." });
    }
  });

  app.get("/api/client/vendors/questionnaires", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const list = db.data.vendorQuestionnaires
      .filter(q => q.userId === targetId)
      .map(q => ({
        id: q.id, createdAt: q.createdAt,
        questionCount: q.answers?.length || 0,
        needsInputCount: (q.answers || []).filter(a => a.needsHumanInput).length,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(list);
  });

  app.get("/api/client/vendors/questionnaires/:id", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const record = db.data.vendorQuestionnaires.find(q => q.id === req.params.id && q.userId === targetId);
    if (!record) return res.status(404).json({ error: "Questionnaire response not found." });
    res.json(record);
  });

  app.delete("/api/client/vendors/questionnaires/:id", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;
    const before = db.data.vendorQuestionnaires.length;
    db.data.vendorQuestionnaires = db.data.vendorQuestionnaires.filter(q => !(q.id === req.params.id && q.userId === targetId));
    if (db.data.vendorQuestionnaires.length === before) return res.status(404).json({ error: "Questionnaire response not found." });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // ── Staff: portfolio-wide overdue/due-soon queue ─────────────
  // Admin sees every client; an analyst sees only their assigned clients.
  app.get("/api/staff/vendors/overdue-queue", requireAuth, (req, res) => {
    if (!req.isAdmin && !req.isAnalyst) return res.status(403).json({ error: "Staff access required." });
    let queue = portfolioOverdueQueue(db);
    if (req.isAnalyst && !req.isAdmin && typeof analystClientIds === "function") {
      const mine = new Set(analystClientIds(db, req.userId));
      queue = queue.filter(q => mine.has(q.userId));
    }
    res.json({ queue });
  });

  console.log("ShieldAI vendor-risk-management routes registered.");
}
