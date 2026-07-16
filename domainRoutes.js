// domainRoutes.js
// The company-domain workflow that gates breach monitoring.
//
// Client side:  submit a domain -> publish a DNS TXT record -> we verify it.
// Admin side:   a queue of domains needing manual enrollment in the HIBP
//               dashboard, and controls to record what happened there.
//
// Nothing here touches a client system. Domain ownership is proved by a DNS
// TXT record the client publishes themselves.

import { randomUUID } from "crypto";
import {
  submitDomain,
  checkOwnership,
  getClientDomain,
  verificationInstructions,
  clientView,
  adminQueue,
  setHibpStatus,
  normalizeDomain,
  HIBP_STATUS,
} from "./domainService.js";
import { darkwebConfigured, suggestedDomain } from "./darkwebService.js";

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

// Resolve which client a staff request is acting on, enforcing analyst scope.
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

export function registerDomainRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient }) {
  db.data.clientDomains ||= [];

  // ── Client: current domain + what to do next ────────────────
  app.get("/api/client/domain", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;

    const record = getClientDomain(db, targetId);
    const view = clientView(record, { hibpConfigured: darkwebConfigured() });
    res.json({
      userId: targetId,
      ...view,
      // Only a pre-fill hint for the form — never used for live queries.
      suggested: record ? null : suggestedDomain(db, targetId),
      serviceConfigured: darkwebConfigured(),
    });
  });

  // ── Client: submit / change the company domain ──────────────
  app.post("/api/client/domain", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;

    try {
      const record = await submitDomain(db, targetId, req.body?.domain, req.userEmail);
      if (targetId !== req.userId) {
        audit(db, req, "domain_submitted_for_client", targetId, record.domain);
        await db.write();
      }
      res.json({
        userId: targetId,
        ...clientView(record, { hibpConfigured: darkwebConfigured() }),
        instructions: verificationInstructions(record),
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not save that domain." });
    }
  });

  // ── Client: run the DNS TXT check ───────────────────────────
  app.post("/api/client/domain/verify", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;

    try {
      const record = await checkOwnership(db, targetId);
      res.json({
        userId: targetId,
        verified: record.ownership === "verified",
        ...clientView(record, { hibpConfigured: darkwebConfigured() }),
        lastCheckedAt: record.lastCheckedAt,
        lastCheckError: record.lastCheckError,
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Verification check failed." });
    }
  });

  // ── Admin: the enrollment queue ─────────────────────────────
  // Shows what needs a human to do something, and where.
  app.get("/api/admin/domains", requireAdmin, (req, res) => {
    const q = adminQueue(db);
    res.json({
      ...q,
      serviceConfigured: darkwebConfigured(),
      // The manual step this queue exists to support.
      dashboardUrl: "https://haveibeenpwned.com/DomainSearch",
      note: darkwebConfigured()
        ? "Domains marked 'ready to enroll' have proved ownership. Add them at haveibeenpwned.com/DomainSearch, then record the result here."
        : "HIBP_API_KEY is not set on this deployment — breach monitoring is inactive regardless of domain status.",
    });
  });

  // ── Admin: record what happened in the HIBP dashboard ───────
  app.post("/api/admin/domains/:userId/hibp-status", requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const { status, note } = req.body || {};
    try {
      const record = await setHibpStatus(db, userId, status, { note, actorEmail: req.userEmail });
      audit(db, req, `domain_hibp_${status}`, userId, `${record.domain}${note ? ` — ${note}` : ""}`);
      await db.write();
      res.json({ userId, domain: record.domain, hibpStatus: record.hibpStatus, record });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not update status." });
    }
  });

  // ── Admin: re-run a client's DNS check ──────────────────────
  app.post("/api/admin/domains/:userId/recheck", requireAdmin, async (req, res) => {
    try {
      const record = await checkOwnership(db, req.params.userId);
      res.json({ userId: req.params.userId, ownership: record.ownership, record });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Recheck failed." });
    }
  });

  // ── Admin: the valid status values (keeps the UI honest) ────
  app.get("/api/admin/domains/statuses", requireAdmin, (req, res) => {
    res.json({
      statuses: [
        { id: HIBP_STATUS.NOT_SUBMITTED, label: "Not submitted", help: "Not yet added to the HIBP dashboard." },
        { id: HIBP_STATUS.SUBMITTED, label: "Submitted to HIBP", help: "Added at haveibeenpwned.com/DomainSearch, awaiting their verification." },
        { id: HIBP_STATUS.VERIFIED, label: "Verified — monitoring live", help: "HIBP confirmed. Requires client ownership to be verified first." },
        { id: HIBP_STATUS.REJECTED, label: "Rejected", help: "HIBP couldn't verify or the domain is out of scope." },
      ],
    });
  });

  console.log("ShieldAI domain-verification routes registered.");
}
