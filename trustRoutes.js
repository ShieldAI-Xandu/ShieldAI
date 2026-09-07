// trustRoutes.js
// Public, shareable "trust page" — a client can opt in to a read-only page
// (no ShieldAI login) that shows a prospect or customer of THEIRS a trimmed,
// white-labeled view of their own security posture and chosen compliance
// frameworks. The closest analog to Vanta's "Trust Center."
//
// PUBLIC-ROUTE PATTERN: copies the house pattern exactly
// (phishingRoutes.js's /api/phish/:token, trainingProgramRoutes.js's
// /api/train/:token) — no requireAuth at all, a random token looked up
// directly in one collection, response is a hand-picked narrow projection,
// never the underlying record.
//
// WHAT'S SHOWN, DELIBERATELY TRIMMED: only {score, level} from
// riskEngine.js's computePostureScore() — never the per-function
// factors/finding text, which reads like a public vulnerability disclosure
// (see riskEngine.js's own factor findings, e.g. "No reliable data backups
// — major risk"). Per opted-in framework, only complianceBridge.js's
// {compliancePct, readinessPct} summary — never `requirements`, `excluded`,
// or `detail`. This mirrors the trimming precedent submissionPacket.js
// already set (posture:{score,level}) rather than inventing a new one.
//
// A framework only ever appears here if checkFrameworkAccess() (the exact
// same rule the client's own Compliance tab and submissionPacket.js
// enforce) says the client actually selected it and it's within their
// plan's framework limit — never something they never chose or aren't
// entitled to.
//
// riskEngine.js note: same as every other read source in this codebase —
// this never feeds the posture SCORE, it only reads the existing one.
//
// Mount from server.js:
//   import { registerTrustRoutes } from "./trustRoutes.js";
//   registerTrustRoutes(app, { db, requireAuth, gate });

import { randomUUID } from "crypto";
import { getFrameworkDef, evaluateFramework, toRegistryId } from "./complianceBridge.js";
import { toAssessOpts } from "./frameworkIntake.js";
import { checkFrameworkAccess } from "./complianceRoutes.js";
import { computePostureScore } from "./riskEngine.js";
import { resolveBrandingForUser } from "./brandingRoutes.js";
import { hasCapability } from "./tiers.js";

const nowIso = () => new Date().toISOString();

function ensureCollections(db) {
  db.data.trustPages ||= [];
}

// Own copy of "find a client's latest assessment" / checklist / framework
// intake opts — same three tiny helpers submissionPacket.js,
// complianceRoutes.js, and reportRoutes.js each keep their own copy of,
// rather than a shared utility (this codebase's established convention).
function latestAssessmentFor(db, userId) {
  const list = (db.data.assessments || []).filter((a) => a.userId === userId);
  if (!list.length) return null;
  return list.reduce(
    (best, a) =>
      !best || new Date(a.updatedAt || a.createdAt) > new Date(best.updatedAt || best.createdAt)
        ? a
        : best,
    null,
  );
}
function checklistOf(a) {
  return a?.data?.checklist || a?.data?.securityChecklist || {};
}
function optsFor(a) {
  const stored = a?.data?.frameworkIntake || {};
  const out = {};
  for (const [fid, answers] of Object.entries(stored)) {
    if (!answers) continue;
    try { out[toRegistryId(fid)] = toAssessOpts(toRegistryId(fid), answers); } catch { /* skip malformed scoping */ }
  }
  return out;
}

function selectedFrameworkIdsFor(a) {
  return Array.isArray(a?.data?.selectedFrameworks) ? a.data.selectedFrameworks.map(f => f.id).filter(Boolean) : [];
}

function publicView(t, availableFrameworks) {
  return {
    enabled: !!t?.enabled,
    frameworksShown: t?.frameworksShown || [],
    token: t?.token || null,
    viewCount: t?.viewCount || 0,
    lastViewedAt: t?.lastViewedAt || null,
    updatedAt: t?.updatedAt || null,
    availableFrameworks,
  };
}

// Assembles the trimmed, external-safe payload a public visitor sees —
// same "pull from the real engines, keep only score/level and
// compliancePct/readinessPct" pattern submissionPacket.js established.
function buildPublicTrustPayload(db, gate, trustPage) {
  const owner = (db.data.users || []).find(u => u.id === trustPage.ownerUserId);
  const a = latestAssessmentFor(db, trustPage.ownerUserId);
  const posture = a ? computePostureScore(a.data) : null;
  const branding = resolveBrandingForUser(db, owner);

  const frameworks = [];
  if (a) {
    const checklist = checklistOf(a);
    const optsByFramework = optsFor(a);
    for (const fid of trustPage.frameworksShown || []) {
      const def = getFrameworkDef(fid);
      if (!def) continue;
      // Never show a framework the client isn't actually entitled to (or
      // never selected) — same rule the client's own Compliance tab and
      // submissionPacket.js enforce, so this can't drift ahead of what a
      // tier downgrade or a framework they dropped should still show.
      const access = checkFrameworkAccess(gate, trustPage.ownerUserId, def, a);
      if (!access.ok) continue;
      const opts = optsByFramework[toRegistryId(fid)] || {};
      const report = evaluateFramework(fid, checklist, opts);
      frameworks.push({
        id: def.id,
        name: def.name,
        notControlMapped: !!report.notControlMapped,
        compliancePct: report.summary?.compliancePct ?? null,
        readinessPct: report.summary?.readinessPct ?? null,
      });
    }
  }

  return {
    companyName: owner?.companyName || "This company",
    industry: owner?.industry || null,
    posture: posture ? { score: posture.postureScore, level: posture.postureLevel } : null,
    frameworks,
    branding: {
      productName: branding.productName,
      companyName: branding.companyName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      accentColor: branding.accentColor,
    },
    updatedAt: a?.updatedAt || a?.createdAt || null,
  };
}

export function registerTrustRoutes(app, { db, requireAuth, gate }) {
  ensureCollections(db);

  function myTrustPage(userId) {
    return (db.data.trustPages || []).find(x => x.ownerUserId === userId);
  }

  // Frameworks the client has actually selected and is entitled to show —
  // computed here so the frontend doesn't need a second fetch to build the
  // picker, and can't offer a framework the client never chose.
  function availableFrameworksFor(userId) {
    const a = latestAssessmentFor(db, userId);
    if (!a) return [];
    const out = [];
    for (const fid of selectedFrameworkIdsFor(a)) {
      const def = getFrameworkDef(fid);
      if (!def) continue;
      const access = checkFrameworkAccess(gate, userId, def, a);
      if (!access.ok) continue;
      out.push({ id: def.id, name: def.name });
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES (their own trust page only — staff manage one on a
  //  client's behalf via impersonation, same as every other client-owned
  //  setting in this app; no separate staff path needed here)
  // ════════════════════════════════════════════════════════════

  app.get("/api/trust/mine", requireAuth, gate.capability("trustPage"), (req, res) => {
    res.json(publicView(myTrustPage(req.userId), availableFrameworksFor(req.userId)));
  });

  app.put("/api/trust/mine", requireAuth, gate.capability("trustPage"), async (req, res) => {
    const enabled = !!req.body?.enabled;
    const available = new Set(availableFrameworksFor(req.userId).map(f => f.id));
    const frameworksShown = Array.isArray(req.body?.frameworksShown)
      ? req.body.frameworksShown.filter(id => available.has(id)).slice(0, 20)
      : [];

    let t = myTrustPage(req.userId);
    if (!t) {
      t = {
        id: randomUUID(), ownerUserId: req.userId, token: randomUUID(),
        enabled, frameworksShown,
        createdAt: nowIso(), updatedAt: nowIso(), lastViewedAt: null, viewCount: 0,
      };
      db.data.trustPages.push(t);
    } else {
      t.enabled = enabled;
      t.frameworksShown = frameworksShown;
      t.updatedAt = nowIso();
    }
    await db.write();
    res.json(publicView(t, availableFrameworksFor(req.userId)));
  });

  // Rotates the public link, invalidating the old one — same "regenerate
  // the credential to invalidate anything issued before it" idea auth.js's
  // password-reset nonce uses.
  app.post("/api/trust/mine/regenerate", requireAuth, gate.capability("trustPage"), async (req, res) => {
    const t = myTrustPage(req.userId);
    if (!t) return res.status(404).json({ error: "No trust page to regenerate yet — enable one first." });
    t.token = randomUUID();
    t.updatedAt = nowIso();
    await db.write();
    res.json(publicView(t, availableFrameworksFor(req.userId)));
  });

  // ════════════════════════════════════════════════════════════
  //  PUBLIC ROUTE — no requireAuth, matching /api/phish/:token exactly.
  // ════════════════════════════════════════════════════════════
  app.get("/api/trust/:token", async (req, res) => {
    const t = (db.data.trustPages || []).find(x => x.token === req.params.token);
    if (!t || !t.enabled) return res.status(404).json({ error: "This page isn't available." });

    // If the owner's plan no longer includes the trust page (e.g. they
    // downgraded), the public link stops resolving even though the DB
    // record still says enabled — a tier downgrade shouldn't leave a
    // feature reachable from outside the product.
    const tier = gate.tierOf(t.ownerUserId);
    if (!hasCapability(tier, "trustPage")) return res.status(404).json({ error: "This page isn't available." });

    t.viewCount = (t.viewCount || 0) + 1;
    t.lastViewedAt = nowIso();
    await db.write();

    try {
      res.json(buildPublicTrustPayload(db, gate, t));
    } catch (err) {
      console.error("Trust page render error:", err.message);
      res.status(500).json({ error: "Could not load this page." });
    }
  });

  console.log("ShieldAI trust page routes registered.");
}
