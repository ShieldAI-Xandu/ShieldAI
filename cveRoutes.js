// cveRoutes.js
// Routes exposing ShieldAI's vulnerability intelligence (NVD/CVE) and the
// authoritative reference links. Read-only; no action is ever taken on a
// client system from here.

import {
  SECURITY_REFERENCES,
  searchByKeyword,
  exposureForSoftware,
  clientSoftwareDescriptors,
  refreshClientExposure,
} from "./cveService.js";
import {
  clientDomain,
  clientExposure,
  refreshClientDarkweb,
  darkwebConfigured,
} from "./darkwebService.js";

export function registerCveRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient }) {
  // Public-ish: the curated reference links (cve.org, MITRE, NVD, NIST, CNSS).
  app.get("/api/cve/refs", requireAuth, (req, res) => {
    res.json({ references: SECURITY_REFERENCES });
  });

  // Ad-hoc keyword search against the live NVD CVE API.
  // e.g. GET /api/cve/search?q=OpenSSL%203.0.1&limit=5&severity=HIGH
  app.get("/api/cve/search", requireAuth, async (req, res) => {
    const q = req.query.q || req.query.keyword;
    if (!q) return res.status(400).json({ error: "Provide ?q= (software, e.g. 'Apache 2.4.49')." });
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const severity = req.query.severity || null;
    const result = await searchByKeyword(q, { limit, severity });
    res.json(result);
  });

  // A client's own consolidated CVE exposure, derived from the software their
  // agents/assessment report. Clients see only their own; staff can pass ?userId=.
  app.get("/api/client/cve-exposure", requireAuth, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.query.userId && req.query.userId !== req.userId) {
      // Only staff (and analysts who own the client) may view someone else's.
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.query.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.query.userId;
    }

    const software = clientSoftwareDescriptors(db, targetId);
    if (software.length === 0) {
      return res.json({
        userId: targetId, software: [], exposure: null,
        note: "No software inventory found yet. CVE matching needs the monitoring agent's inventory or a tech-stack entry in the assessment — a website URL alone can't be matched to CVEs.",
      });
    }
    const exposure = await exposureForSoftware(software);
    res.json({ userId: targetId, software, exposure });
  });

  // Recompute and cache a client's CVE exposure (so Mastermind sees it fresh).
  // Clients may refresh their own; staff may refresh anyone they're allowed to.
  app.post("/api/client/cve-exposure/refresh", requireAuth, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.body?.userId && req.body.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.body.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.body.userId;
    }
    const record = await refreshClientExposure(db, targetId);
    res.json({ userId: targetId, exposure: record });
  });

  // ── Dark-web / breach exposure (Have I Been Pwned) ──────────────
  // A client's breach exposure for their domain. Honest about inactive/
  // unverified states — never a fabricated all-clear.
  app.get("/api/client/darkweb-exposure", requireAuth, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.query.userId && req.query.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.query.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.query.userId;
    }
    // clientExposure enforces the verification gates: it will not query HIBP
    // for a domain the client hasn't registered and proved control of.
    const exposure = await clientExposure(db, targetId);
    res.json({ userId: targetId, configured: darkwebConfigured(), exposure });
  });

  app.post("/api/client/darkweb-exposure/refresh", requireAuth, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.body?.userId && req.body.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.body.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.body.userId;
    }
    const record = await refreshClientDarkweb(db, targetId);
    res.json({ userId: targetId, exposure: record });
  });
}
