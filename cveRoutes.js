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
  cveServiceStatus,
  probeCve,
} from "./cveService.js";
import {
  clientDomain,
  clientExposure,
  refreshClientDarkweb,
  darkwebConfigured,
  darkwebServiceStatus,
  probeDarkweb,
} from "./darkwebService.js";

export function registerCveRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient }) {
  // ── Admin: threat-intelligence service status ───────────────
  // Shows which external intel services are configured and what the gaps cost.
  // Deliberately reports capability honestly rather than a green light per key:
  // a configured key is not the same as a working service, and for HIBP a key
  // alone still isn't enough (domains need manual enrollment).
  app.get("/api/admin/threat-intel/status", requireAdmin, (req, res) => {
    const cve = cveServiceStatus();
    const hibp = darkwebServiceStatus(db);
    res.json({
      services: [cve, hibp],
      summary: {
        // Only HIBP is required; NVD unkeyed is slow, not broken.
        operational: hibp.configured,
        degraded: !cve.configured,
        blockers: [
          !hibp.configured && "HIBP_API_KEY is not set — breach monitoring is inactive for all clients.",
          hibp.configured && hibp.domainsRegistered > 0 && hibp.domainsMonitored === 0 &&
            "No client domains are fully enrolled yet — monitoring won't return data until they are.",
        ].filter(Boolean),
        advisories: [
          !cve.configured &&
            `NVD_API_KEY is not set — CVE refreshes take up to ~${cve.worstCaseRefreshSec}s instead of ~8s. Accuracy is unaffected.`,
        ].filter(Boolean),
      },
      checkedAt: new Date().toISOString(),
    });
  });

  // ── Admin: live probe of both services ──────────────────────
  // Actually calls each API. Slower than the status read, so it's a separate,
  // explicit action rather than something that runs on page load.
  app.post("/api/admin/threat-intel/probe", requireAdmin, async (req, res) => {
    const [cve, hibp] = await Promise.all([probeCve(), probeDarkweb()]);
    res.json({ probes: { nvd: cve, hibp }, checkedAt: new Date().toISOString() });
  });


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
