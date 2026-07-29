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
  addDomain,
  removeDomain,
  adminRemoveDomain,
  checkOwnership,
  getClientDomain,
  listClientDomains,
  getDomainById,
  clientView,
  adminQueue,
  setHibpStatus,
  normalizeDomain,
  HIBP_STATUS,
} from "./domainService.js";
import { darkwebConfigured, suggestedDomain } from "./darkwebService.js";
import { scanEmailSecurity } from "./emailSecurityService.js";

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

  // ── Client: all domains on file + what to do next on each ───
  // A client can register more than one domain (parent company + brands,
  // regional TLDs, etc.); each one goes through ownership + HIBP enrollment
  // independently. Empty list uses the same "none" shape a single missing
  // domain used to, so the UI's empty state doesn't need special-casing.
  app.get("/api/client/domain", requireAuth, (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;

    const records = listClientDomains(db, targetId);
    // clientView() already attaches `instructions` itself, and only for the
    // "awaiting_ownership" state — a domain that's already verified/monitored
    // has no DNS step left to show. Don't re-attach it unconditionally here.
    const domains = records.map(record => ({
      id: record.id,
      ...clientView(record, { hibpConfigured: darkwebConfigured() }),
      lastCheckedAt: record.lastCheckedAt,
      lastCheckError: record.lastCheckError,
    }));
    res.json({
      userId: targetId,
      domains,
      // Only a pre-fill hint for the "add another" form — never used for live queries.
      suggested: records.length ? null : suggestedDomain(db, targetId),
      serviceConfigured: darkwebConfigured(),
    });
  });

  // ── Client: add a domain ─────────────────────────────────────
  app.post("/api/client/domain", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;

    try {
      const record = await addDomain(db, targetId, req.body?.domain, req.userEmail);
      if (targetId !== req.userId) {
        audit(db, req, "domain_submitted_for_client", targetId, record.domain);
        await db.write();
      }
      res.json({
        userId: targetId,
        id: record.id,
        ...clientView(record, { hibpConfigured: darkwebConfigured() }),
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not save that domain." });
    }
  });

  // ── Client: remove a domain ──────────────────────────────────
  app.delete("/api/client/domain/:id", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;

    try {
      const removed = await removeDomain(db, targetId, req.params.id);
      if (targetId !== req.userId) {
        audit(db, req, "domain_removed_for_client", targetId, removed.domain);
        await db.write();
      }
      res.json({ ok: true, id: removed.id });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not remove that domain." });
    }
  });

  // ── Client: run the DNS TXT check for one domain ─────────────
  app.post("/api/client/domain/:id/verify", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.body?.userId);
    if (!targetId) return;

    try {
      const record = await checkOwnership(db, targetId, req.params.id);
      res.json({
        userId: targetId,
        id: record.id,
        verified: record.ownership === "verified",
        ...clientView(record, { hibpConfigured: darkwebConfigured() }),
        lastCheckedAt: record.lastCheckedAt,
        lastCheckError: record.lastCheckError,
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Verification check failed." });
    }
  });

  // ── Client: email authentication scan (SPF/DKIM/DMARC/MX) ───
  // Independent of the ownership-verification gate above — these are all
  // public DNS records, so checking them carries none of the privacy
  // concern that gates HIBP monitoring (isMonitorable). Reuses whatever
  // domain the client already has on file rather than asking for a second
  // one. Cached on the domain record for 24h so viewing the dashboard
  // repeatedly doesn't re-run five DNS lookups every time; ?rescan=1 forces
  // a fresh scan on demand.
  const SCAN_TTL_MS = 24 * 60 * 60 * 1000;
  app.get("/api/client/domain/email-security", requireAuth, async (req, res) => {
    const targetId = resolveTarget(req, res, db, analystOwnsClient, req.query.userId);
    if (!targetId) return;

    const record = getClientDomain(db, targetId);
    if (!record) return res.status(404).json({ error: "No domain on file. Submit your company domain first." });

    const fresh = record.emailSecurityScan
      && record.emailSecurityScannedAt
      && (Date.now() - new Date(record.emailSecurityScannedAt).getTime()) < SCAN_TTL_MS;

    if (fresh && req.query.rescan !== "1") {
      return res.json({ userId: targetId, ...record.emailSecurityScan, cached: true });
    }

    try {
      const scan = await scanEmailSecurity(record.domain);
      record.emailSecurityScan = scan;
      record.emailSecurityScannedAt = scan.scannedAt;
      await db.write();
      res.json({ userId: targetId, ...scan, cached: false });
    } catch (err) {
      res.status(500).json({ error: err.message || "Email security scan failed." });
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
  // Keyed by the domain record's own id now (not userId) — a client can have
  // more than one domain, so userId alone no longer identifies a row.
  app.post("/api/admin/domains/:domainId/hibp-status", requireAdmin, async (req, res) => {
    const { domainId } = req.params;
    const { status, note } = req.body || {};
    try {
      const record = await setHibpStatus(db, domainId, status, { note, actorEmail: req.userEmail });
      audit(db, req, `domain_hibp_${status}`, record.userId, `${record.domain}${note ? ` — ${note}` : ""}`);
      await db.write();
      res.json({ userId: record.userId, domain: record.domain, hibpStatus: record.hibpStatus, record });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not update status." });
    }
  });

  // ── Admin: remove a domain outright ─────────────────────────
  // Not scoped to the domain's own userId, unlike the client-facing delete
  // above — this exists for accounts that can't reach the client route
  // themselves (e.g. no active program) but still have a stale/incorrect
  // domain on file that's blocking it from being registered elsewhere.
  app.delete("/api/admin/domains/:domainId", requireAdmin, async (req, res) => {
    try {
      const removed = await adminRemoveDomain(db, req.params.domainId);
      audit(db, req, "domain_removed_by_admin", removed.userId, removed.domain);
      await db.write();
      res.json({ ok: true, id: removed.id, domain: removed.domain });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || "Could not remove that domain." });
    }
  });

  // ── Admin: re-run a client's DNS check ──────────────────────
  app.post("/api/admin/domains/:domainId/recheck", requireAdmin, async (req, res) => {
    const target = getDomainById(db, req.params.domainId);
    if (!target) return res.status(404).json({ error: "Domain not found." });
    try {
      const record = await checkOwnership(db, target.userId, req.params.domainId);
      res.json({ userId: record.userId, ownership: record.ownership, record });
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
