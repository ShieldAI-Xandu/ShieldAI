// cveRoutes.js
// Routes exposing ShieldAI vCISO's vulnerability intelligence (NVD/CVE) and the
// authoritative reference links. Read-only; no action is ever taken on a
// client system from here.

import {
  SECURITY_REFERENCES,
  searchByKeyword,
  exposureForSoftware,
  clientSoftwareDescriptors,
  refreshClientExposure,
  cachedExposure,
} from "./cveService.js";
import { cveImpact } from "./findingImpact.js";
import {
  clientDomain,
  clientExposure,
  refreshClientDarkweb,
  darkwebConfigured,
} from "./darkwebService.js";
import {
  clientAttackSurface,
  refreshClientAttackSurface,
} from "./attackSurfaceService.js";
import { THREAT_INTEL_SOURCES } from "./threatIntelSources.js";

export function registerCveRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient, gate, callClaudeText, aiLimiter }) {
  // Real CVE/dark-web exposure viewing is the `threatIntel` capability
  // (Growth+) — matches the Dashboard's Threat Intel tab and FEATURE_CATALOG.
  // Domain registration/verification and the plain SPF/DKIM/DMARC email-
  // security lookup live in domainRoutes.js and are intentionally NOT gated
  // here (see that file) — only the real exposure data is a paid feature.
  const threatIntelGate = gate ? gate.capability("threatIntel") : (req, res, next) => next();
  // ── Admin: threat-intelligence service status ───────────────
  // Shows which external intel services are configured and what the gaps cost.
  // Deliberately reports capability honestly rather than a green light per key:
  // a configured key is not the same as a working service, and for HIBP a key
  // alone still isn't enough (domains need manual enrollment).
  app.get("/api/admin/threat-intel/status", requireAdmin, (req, res) => {
    const services = THREAT_INTEL_SOURCES.map(s => s.statusFn(db));
    const nvd = services.find(s => s.id === "nvd");
    const hibp = services.find(s => s.id === "hibp");
    res.json({
      services,
      summary: {
        // Only HIBP is required; NVD unkeyed is slow, not broken. Unchanged
        // rule from before this became a registry loop.
        operational: hibp.configured,
        degraded: !nvd.configured,
        // Sources still marked `implemented: false` (EPSS/OSV/ATT&CK today)
        // are permanently-planned, not degraded — their advisoryText would
        // otherwise make the "all configured" all-clear unreachable forever,
        // even when every real, built source is fully healthy. Each one's
        // own status is still shown per-service further down the page.
        blockers: services.filter(s => s.implemented !== false).map(s => s.blockerText).filter(Boolean),
        advisories: services.filter(s => s.implemented !== false).map(s => s.advisoryText).filter(Boolean),
      },
      checkedAt: new Date().toISOString(),
    });
  });

  // ── Admin: live probe of every registered service ────────────
  // Actually calls each API. Slower than the status read, so it's a separate,
  // explicit action rather than something that runs on page load.
  app.post("/api/admin/threat-intel/probe", requireAdmin, async (req, res) => {
    const entries = await Promise.all(THREAT_INTEL_SOURCES.map(async s => [s.id, await s.probeFn()]));
    res.json({ probes: Object.fromEntries(entries), checkedAt: new Date().toISOString() });
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
  app.get("/api/client/cve-exposure", requireAuth, threatIntelGate, async (req, res) => {
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

    const software = clientSoftwareDescriptors(db, targetId, { isDemo: req.isDemo });
    if (software.length === 0) {
      return res.json({
        userId: targetId, software: [], exposure: null,
        note: "No software inventory found yet. CVE matching needs the monitoring agent's inventory or a tech-stack entry in the assessment — a website URL alone can't be matched to CVEs.",
      });
    }
    const exposure = await exposureForSoftware(software);
    res.json({ userId: targetId, software, exposure });
  });

  // Plain-language "what this could mean for your business" narrative for one
  // CVE, on top of the real NVD description/CVSS/KEV facts already shown
  // inline. Grounded and cached — see findingImpact.js's own header for why.
  //
  // The CVE is looked up in the CLIENT'S OWN cached exposure (cachedExposure's
  // `top` list) rather than accepted as facts in the request body — the
  // client can only request a narrative for a CVE their own scan actually
  // found, not fabricate arbitrary "facts" to get free-text generation out of
  // the AI budget.
  app.get("/api/client/cve-exposure/:cveId/impact", requireAuth, threatIntelGate, aiLimiter, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.query.userId && req.query.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.query.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.query.userId;
    }

    const exposure = cachedExposure(db, targetId);
    const cve = (exposure?.top || []).find(c => c.id === req.params.cveId);
    if (!cve) {
      return res.status(404).json({ error: "That CVE isn't in this client's current exposure results. Refresh CVE exposure and try again." });
    }

    const result = await cveImpact(db, cve, { callClaudeText });
    await db.write();
    res.json(result);
  });

  // Recompute and cache a client's CVE exposure (so Mastermind sees it fresh).
  // Clients may refresh their own; staff may refresh anyone they're allowed to.
  app.post("/api/client/cve-exposure/refresh", requireAuth, threatIntelGate, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.body?.userId && req.body.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.body.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.body.userId;
    }
    const record = await refreshClientExposure(db, targetId, { isDemo: req.isDemo });
    res.json({ userId: targetId, exposure: record });
  });

  // ── Dark-web / breach exposure (Have I Been Pwned) ──────────────
  // A client's breach exposure for their domain. Honest about inactive/
  // unverified states — never a fabricated all-clear.
  app.get("/api/client/darkweb-exposure", requireAuth, threatIntelGate, async (req, res) => {
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
    const exposure = await clientExposure(db, targetId, { isDemo: req.isDemo });
    res.json({ userId: targetId, configured: darkwebConfigured() || !!req.isDemo, exposure });
  });

  app.post("/api/client/darkweb-exposure/refresh", requireAuth, threatIntelGate, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.body?.userId && req.body.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.body.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.body.userId;
    }
    const record = await refreshClientDarkweb(db, targetId, { isDemo: req.isDemo });
    res.json({ userId: targetId, exposure: record });
  });

  // ── Attack-surface discovery (crt.sh subdomains + HTTP banner probing) ──
  // A client's own external attack surface. clientAttackSurface() enforces
  // the domain-ownership-verification gate: it will not make any outbound
  // connection to a domain the client hasn't registered and proved control
  // of. Discovered software feeds cveService.clientSoftwareDescriptors(),
  // so a subsequent /api/client/cve-exposure call picks it up automatically.
  app.get("/api/client/attack-surface", requireAuth, threatIntelGate, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.query.userId && req.query.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.query.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.query.userId;
    }
    const surface = await clientAttackSurface(db, targetId, { isDemo: req.isDemo });
    res.json({ userId: targetId, surface });
  });

  app.post("/api/client/attack-surface/refresh", requireAuth, threatIntelGate, async (req, res) => {
    let targetId = req.userId;
    const isStaff = req.isAdmin || req.isAnalyst;
    if (req.body?.userId && req.body.userId !== req.userId) {
      if (!isStaff) return res.status(403).json({ error: "Not permitted." });
      if (req.isAnalyst && analystOwnsClient && !analystOwnsClient(db, req.userId, req.body.userId)) {
        return res.status(403).json({ error: "This client is not assigned to you." });
      }
      targetId = req.body.userId;
    }
    const record = await refreshClientAttackSurface(db, targetId, { isDemo: req.isDemo });
    res.json({ userId: targetId, surface: record });
  });
}
