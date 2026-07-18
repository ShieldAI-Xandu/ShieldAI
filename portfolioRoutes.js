// portfolioRoutes.js
// Analyst-console portfolio backend. Replaces the SAMPLE_CLIENTS mockup with
// real, assignment-scoped data assembled from collections that already exist.
//
// Phases delivered here:
//   1) GET /api/analyst/portfolio           — per-client rollup (identity, tier,
//                                              posture, agent health, open recs)
//   2) GET /api/analyst/clients/:id/posture-history — 12-point posture trend,
//                                              backfilled from programs + snapshots
//   3) GET /api/analyst/clients/:id/alerts   — recent security events for a client
//      GET /api/analyst/clients/:id/review-queue — programs/policies awaiting review
//
// Also exports recordPostureSnapshot(db, userId, score, level) so the program
// pipeline can append a real posture point whenever a program is (re)scored.
//
// Mount from server.js:
//   import { registerPortfolioRoutes } from "./portfolioRoutes.js";
//   registerPortfolioRoutes(app, { db, requireAuth, requireAdmin,
//                                   analystClientIds, analystOwnsClient });
//
// Access model mirrors the existing analyst routes: admins see all non-admin
// clients; analysts see only clients assigned to them.

import { logClientAction } from "./assignmentRoutes.js";
// The same engine the client's own dashboard uses. Scoring the analyst's view
// from a different source than the client's would let the two disagree, which
// is the one thing a vCISO dashboard cannot do.
import { computePostureScore } from "./riskEngine.js";
import { disputes } from "./agentEvidence.js";
import { toEvidence } from "./securityChecklist.js";
import { evaluateAllFrameworks } from "./complianceBridge.js";

const nowIso = () => new Date().toISOString();

// ── notifications ────────────────────────────────────────────
// Lightweight per-user notification. Bounded to keep the JSON db small.
export function pushNotification(db, { userId, type, title, body, link, actorRole }) {
  if (!userId) return;
  db.data.notifications ||= [];
  db.data.notifications.push({
    id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    userId,
    type: type || "info",
    title: (title || "").slice(0, 200),
    body: (body || "").slice(0, 1000),
    link: link || null,
    actorRole: actorRole || "system",
    read: false,
    createdAt: nowIso(),
  });
  // Keep the most recent 200 per user (and overall bounded).
  const mine = db.data.notifications.filter(n => n.userId === userId);
  if (mine.length > 200) {
    const excessIds = new Set(
      mine.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(0, mine.length - 200)
        .map(n => n.id)
    );
    db.data.notifications = db.data.notifications.filter(n => !excessIds.has(n.id));
  }
  if (db.data.notifications.length > 10000) {
    db.data.notifications = db.data.notifications.slice(-10000);
  }
}

// ── posture snapshots ────────────────────────────────────────
// A snapshot is a single { userId, score, level, at } point. We keep the
// history bounded per user and only add a point when the score meaningfully
// changes or a month has passed, so the trend stays readable.
export function recordPostureSnapshot(db, userId, score, level) {
  if (!userId || typeof score !== "number") return;
  db.data.postureSnapshots ||= [];
  const mine = db.data.postureSnapshots.filter(s => s.userId === userId);
  const last = mine.sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  // De-dupe: skip if score is unchanged and the last point is < 20 days old.
  if (last) {
    const ageDays = (Date.now() - new Date(last.at).getTime()) / 86400000;
    if (last.score === Math.round(score) && ageDays < 20) return;
  }
  db.data.postureSnapshots.push({
    userId,
    score: Math.round(score),
    level: level || null,
    at: nowIso(),
  });
  // Bounded growth, matching the clientActions pattern elsewhere.
  if (db.data.postureSnapshots.length > 20000) {
    db.data.postureSnapshots = db.data.postureSnapshots.slice(-20000);
  }
}

export function registerPortfolioRoutes(
  app,
  { db, requireAuth, analystClientIds, analystOwnsClient }
) {
  db.data.postureSnapshots ||= [];

  // Analyst-or-admin gate (self-contained; matches the pattern used by the
  // other analyst routes so we don't depend on a shared middleware export).
  function requireAnalyst(req, res, next) {
    // Run requireAuth first to populate req.userId / req.isAnalyst / req.isAdmin,
    // then enforce the analyst-or-admin role. (Mirrors the gate used by the
    // other analyst routes — req.userId is NOT set by any global middleware.)
    requireAuth(req, res, () => {
      const u = (db.data.users || []).find(x => x.id === req.userId);
      if (!u || (!u.isAnalyst && !u.isAdmin)) {
        return res.status(403).json({ error: "Analyst access required." });
      }
      req.isAdmin = !!u.isAdmin;
      next();
    });
  }

  const users = () => db.data.users || [];
  const findUser = id => users().find(u => u.id === id) || null;

  // Robust admin check — derive from the DB rather than trusting a flag that a
  // caller might not have set, so visibility can't silently fail open/closed.
  function isAdminReq(req) {
    const u = findUser(req.userId);
    return !!(u && u.isAdmin);
  }

  // Which client ids can the caller see? Always a concrete array so callers can
  // .includes() safely. Admins see all real clients (not admin/analyst staff);
  // analysts see only assigned clients.
  function visibleClientIds(req) {
    if (isAdminReq(req)) {
      return users().filter(u => !u.isAdmin && !u.isAnalyst).map(u => u.id);
    }
    return analystClientIds(db, req.userId);
  }

  function canSee(req, clientId) {
    if (isAdminReq(req)) {
      const u = findUser(clientId);
      return !!u && !u.isAdmin;
    }
    return analystOwnsClient(db, req.userId, clientId);
  }

  // Posture for a user.
  //
  // Prefers the stored program's riskOverview (which is what a client saw when
  // their program was generated, so the two views agree). Falls back to
  // computing from the latest assessment.
  //
  // The fallback matters more than it looks. Before it, this read ONLY
  // db.data.programs — so a client who had completed the full assessment but
  // never generated a program showed `posture: null` and, via deriveStatus,
  // rendered as "on track" on the analyst's dashboard. Green for a client we
  // had never scored. The answers were sitting in db.data.assessments the whole
  // time; nothing was asking the engine.
  function latestPosture(userId) {
    const progs = (db.data.programs || [])
      .filter(p => p.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (const p of progs) {
      const ro = p.sections?.riskOverview;
      if (ro && typeof ro.postureScore === "number") {
        const weakest =
          ro.breakdown?.weakestAreas ||
          (Array.isArray(ro.breakdown?.functions)
            ? [...ro.breakdown.functions]
                .sort((x, y) => x.score - y.score)
                .slice(0, 2)
                .map(f => f.name)
            : []);
        return {
          score: ro.postureScore,
          level: ro.postureLevel || null,
          weakest,
          scoredAt: p.meta?.generatedAt || p.createdAt,
          source: "program",
        };
      }
    }

    // No program — score the assessment directly. Same deterministic engine the
    // client's own dashboard uses, so the numbers cannot drift apart.
    const assessments = (db.data.assessments || [])
      .filter(a => a.userId === userId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    const a = assessments[0];
    if (!a?.data) return null;
    try {
      const r = computePostureScore(a.data);
      if (typeof r?.postureScore !== "number") return null;
      return {
        score: r.postureScore,
        level: r.postureLevel || null,
        weakest: (r.weakestAreas || []).map(w => (typeof w === "string" ? w : w.name)).filter(Boolean),
        scoredAt: a.updatedAt || a.createdAt,
        source: "assessment",
      };
    } catch {
      return null;
    }
  }

  // How many agent-vs-questionnaire conflicts are open for this client.
  // Cheap enough to compute per row, and it's the thing an analyst most needs
  // to triage on: a conflict means measured telemetry contradicts what the
  // client believes about their own environment.
  function conflictCount(userId) {
    try {
      const a = (db.data.assessments || [])
        .filter(x => x.userId === userId)
        .sort((x, y) => new Date(y.updatedAt || y.createdAt) - new Date(x.updatedAt || x.createdAt))[0];
      if (!a?.data) return 0;
      const byHost = new Map();
      for (const r of (db.data.agentReports || [])) {
        if (r.ownerUserId !== userId) continue;
        const rep = r.report || r;
        const h = rep?.host?.hostname;
        if (!h) continue;
        const prev = byHost.get(h);
        if (!prev || new Date(r.receivedAt || 0) > new Date(prev.receivedAt || 0)) {
          byHost.set(h, { receivedAt: r.receivedAt, rep });
        }
      }
      if (!byHost.size) return 0;
      const checklist = a.data.checklist || a.data.securityChecklist || {};
      return disputes([...byHost.values()].map(v => v.rep), toEvidence(checklist)).length;
    } catch { return 0; }
  }

  // ── Helpers for the analyst console's per-client fields ──────
  // Each reads the same source as the dedicated endpoint that serves it, so the
  // portfolio row and the drill-down can't disagree.

  // The company profile from the client's latest assessment.
  function latestCompany(userId) {
    const a = (db.data.assessments || [])
      .filter(x => x.userId === userId)
      .sort((x, y) => new Date(y.updatedAt || y.createdAt) - new Date(x.updatedAt || x.createdAt))[0];
    return a?.data?.company || null;
  }

  // Trailing posture scores, one per day, for a sparkline. Same source as
  // /posture-history. Empty array when we've never scored them — NOT a
  // flat line at some default, which would draw a trend that doesn't exist.
  function postureTrend(userId) {
    const points = [];
    for (const s of db.data.postureSnapshots || []) {
      if (s.userId === userId) points.push({ at: s.at, score: s.score });
    }
    for (const h of db.data.postureHistory || []) {
      if (h.userId === userId) points.push({ at: h.at, score: h.score });
    }
    points.sort((a, b) => new Date(a.at) - new Date(b.at));
    const byDay = new Map();
    for (const pt of points) byDay.set(new Date(pt.at).toISOString().slice(0, 10), pt);
    return [...byDay.values()].slice(-12).map(p => p.score);
  }

  // Recent agent events. Same source as /alerts.
  function recentAlerts(userId) {
    return (db.data.agentEvents || [])
      .filter(e => e.ownerUserId === userId)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 5)
      .map(e => ({
        sev: e.severity || "info",
        title: e.message || e.type || "Security event",
        time: e.ts,
        detail: e.detail || e.message || "",
      }));
  }

  // Items awaiting an analyst decision. Same source as /review-queue.
  function reviewItems(userId) {
    const out = [];
    for (const p of db.data.programs || []) {
      if (p.userId !== userId) continue;
      const gen = p.status || "complete";
      if (!["complete", "awaiting_review", "pending", "in_review", "draft"].includes(gen)) continue;
      out.push({
        id: p.id, kind: "program",
        title: p.meta?.companyName ? `Security program — ${p.meta.companyName}` : "Security program",
        status: ["approved", "changes_requested"].includes(p.reviewStatus) ? p.reviewStatus : "awaiting_review",
      });
    }
    for (const d of db.data.policyDocs || []) {
      if (d.userId !== userId) continue;
      out.push({
        id: d.id, kind: "policy", title: d.title || d.name || "Policy",
        status: ["approved", "changes_requested"].includes(d.reviewStatus) ? d.reviewStatus : "awaiting_review",
      });
    }
    return out;
  }

  // Compliance across the client's frameworks, computed by the real engine.
  // Returns null when there's no assessment — the console must render "—", not
  // a percentage. "0% compliant" for a client who hasn't answered is a
  // different and much more alarming statement than "we haven't asked yet".
  function complianceRollup(userId) {
    try {
      const a = (db.data.assessments || [])
        .filter(x => x.userId === userId)
        .sort((x, y) => new Date(y.updatedAt || y.createdAt) - new Date(x.updatedAt || x.createdAt))[0];
      if (!a?.data) return null;
      const checklist = a.data.checklist || a.data.securityChecklist || {};
      if (!Object.keys(checklist).length) return null;
      const rows = evaluateAllFrameworks(checklist).filter(f => !f.notControlMapped && f.assessed > 0);
      if (!rows.length) return null;
      // Lead with the weakest framework — it's what an analyst should look at.
      const worst = [...rows].sort((x, y) => (x.readinessPct ?? 101) - (y.readinessPct ?? 101))[0];
      return {
        framework: worst.short || worst.name,
        current: worst.readinessPct,
        frameworks: rows.length,
        detail: rows.map(f => ({ short: f.short, readinessPct: f.readinessPct, gaps: f.gap })),
      };
    } catch { return null; }
  }

  // Agent-health rollup for a user across all their non-revoked agents.
  function agentHealth(userId) {
    const agents = (db.data.agents || []).filter(
      a => a.ownerUserId === userId && a.status !== "revoked"
    );
    if (agents.length === 0) {
      return { status: "pending", endpoints: 0, healthy: 0, lastSeen: null };
    }
    let healthy = 0;
    let lastSeen = null;
    for (const a of agents) {
      if (a.status === "healthy") healthy++;
      if (a.lastSeen && (!lastSeen || new Date(a.lastSeen) > new Date(lastSeen))) {
        lastSeen = a.lastSeen;
      }
    }
    // Worst-case agent drives the badge (offline > degraded > healthy).
    let status = "healthy";
    if (agents.some(a => a.status === "offline")) status = "offline";
    else if (agents.some(a => a.status === "degraded")) status = "degraded";
    else if (healthy === 0) status = "pending";
    return { status, endpoints: agents.length, healthy, lastSeen };
  }

  function openRecCount(userId) {
    return (db.data.recommendations || []).filter(
      r =>
        r.ownerUserId === userId &&
        !["completed", "declined"].includes(r.status)
    ).length;
  }

  function tierOf(u) {
    return u.tier || "free";
  }

  function subOf(userId) {
    return (db.data.subscriptions || []).find(s => s.userId === userId) || null;
  }

  // Derive a coarse "needs attention" status from real signals so the portfolio
  // cards can sort/triage without any hardcoded state.
  function deriveStatus(posture, health, openRecs, conflicts = 0) {
    if (health.status === "offline") return "attention";
    if (posture && posture.score < 40) return "attention";
    // A conflict means the agent measured something that contradicts what the
    // client told us. That outranks a merely-mediocre score: a wrong answer
    // makes every framework built on it wrong too, and only a human can settle
    // it. It belongs at the top of an analyst's list.
    if (conflicts > 0) return "needs_review";
    if (openRecs > 0) return "needs_review";
    if (posture && posture.score < 60) return "needs_review";
    // No posture means we have no assessment for this client — we know nothing
    // about them. That is NOT "on track". This is an analyst's triage view: a
    // green badge against a client we've never scored is the same lie as
    // reporting "0% compliant" for an unanswered questionnaire, except worse,
    // because it tells a human to look away.
    if (!posture) return "unknown";
    return "on_track";
  }

  // ── Phase 1: portfolio rollup ──────────────────────────────
  app.get("/api/analyst/portfolio", requireAnalyst, (req, res) => {
    const ids = visibleClientIds(req);
    const out = ids
      .map(cid => {
        const u = findUser(cid);
        if (!u) return null;
        const posture = latestPosture(cid);
        const health = agentHealth(cid);
        const openRecs = openRecCount(cid);
        const conflicts = conflictCount(cid);
        const sub = subOf(cid);
        return {
          id: cid,
          name: u.companyName || u.email,
          email: u.email,
          tier: tierOf(u),
          plan: sub?.tier || tierOf(u),
          posture: posture ? posture.score : null,
          level: posture ? posture.level : null,
          weakest: posture ? posture.weakest : [],
          scoredAt: posture ? posture.scoredAt : null,
          // Whether this score came from a generated program or straight from
          // the assessment. An analyst asking "why does this client have a
          // score but no program?" deserves an answer in the payload.
          postureSource: posture ? posture.source : null,
          agent: health,
          openItems: openRecs,
          status: deriveStatus(posture, health, openRecs, conflicts),
          hasProgram: !!posture && posture.source === "program",
          hasAssessment: !!posture,
          // Where the client's conflicts stand. This is the analyst's real
          // queue: agent telemetry disagreeing with a client's answers is a
          // finding that needs a human, and it should not be buried a click
          // deep inside a framework view.
          conflicts,

          // ── Fields the analyst console reads ──────────────────
          // These exist because the console previously rendered SAMPLE_CLIENTS:
          // 143 lines of hardcoded fake clients — invented posture scores,
          // fabricated phishing alerts, made-up MRR — on the landing page an
          // analyst sees first. Real data was being fetched and shown only in a
          // secondary tab.
          //
          // Every field below is real or explicitly null. Nothing is
          // approximated to fill a slot: `null` means we don't have it, and the
          // UI must render that as "—" rather than a plausible-looking number.
          // A fabricated posture score on an analyst's dashboard is worse than
          // an empty one, because it gets acted on.
          industry: latestCompany(cid)?.industry || null,
          employees: latestCompany(cid)?.size || null,
          // No billing integration yet (Stripe deferred), so there is no MRR to
          // report. null, not 0 — zero would read as "this client pays nothing",
          // which is a claim we can't make.
          mrr: null,
          history: postureTrend(cid),
          alerts: recentAlerts(cid),
          reviewQueue: reviewItems(cid),
          compliancePct: complianceRollup(cid),
          lastActivity: posture?.scoredAt || null,
        };
      })
      .filter(Boolean)
      // Attention first, then by weakest posture.
      .sort((a, b) => {
        // attention > needs_review > unknown > on_track.
        // "unknown" sits above "on_track" deliberately: a client we've never
        // scored is a gap in the analyst's coverage, not a success. Sorting it
        // to the bottom next to healthy clients is how it stays unnoticed.
        const rank = s => (s === "attention" ? 0 : s === "needs_review" ? 1 : s === "unknown" ? 2 : 3);
        if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
        return (a.posture ?? 101) - (b.posture ?? 101);
      });
    res.json(out);
  });

  // ── Phase 2: posture history ───────────────────────────────
  // Combine recorded snapshots with any programs that predate the snapshot
  // mechanism, so existing accounts still show a real trend line.
  app.get("/api/analyst/clients/:id/posture-history", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const points = [];

    // From programs (historical, deduped by day).
    for (const p of db.data.programs || []) {
      if (p.userId !== clientId) continue;
      const ro = p.sections?.riskOverview;
      if (ro && typeof ro.postureScore === "number") {
        points.push({
          at: p.meta?.generatedAt || p.createdAt,
          score: Math.round(ro.postureScore),
          level: ro.postureLevel || null,
          source: "program",
        });
      }
    }
    // From snapshots.
    for (const s of db.data.postureSnapshots || []) {
      if (s.userId !== clientId) continue;
      points.push({ at: s.at, score: s.score, level: s.level, source: "snapshot" });
    }

    points.sort((a, b) => new Date(a.at) - new Date(b.at));

    // Collapse to at most one point per calendar day (keep the latest that day),
    // then cap to the trailing 12 for a clean trend.
    const byDay = new Map();
    for (const pt of points) {
      const day = new Date(pt.at).toISOString().slice(0, 10);
      byDay.set(day, pt); // later same-day points overwrite
    }
    const series = [...byDay.values()]
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .slice(-12);

    res.json({
      clientId,
      current: series.length ? series[series.length - 1].score : null,
      points: series,
    });
  });

  // ── Phase 3a: per-client alerts (from agentEvents) ─────────
  app.get("/api/analyst/clients/:id/alerts", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const rows = (db.data.agentEvents || [])
      .filter(e => e.ownerUserId === clientId)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit)
      .map(e => ({
        id: e.id,
        severity: e.severity || "info",
        type: e.type || "event",
        title: e.message || e.type || "Security event",
        source: e.source || "agent",
        time: e.ts,
        ack: !!e.ack,
      }));
    res.json({ clientId, alerts: rows });
  });

  // ── Phase 3b: review queue (programs + policies awaiting review) ──
  app.get("/api/analyst/clients/:id/review-queue", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const queue = [];

    // Programs: a generated program (generation status "complete") is reviewable.
    // The review decision lives in reviewStatus, separate from generation status.
    for (const p of db.data.programs || []) {
      if (p.userId !== clientId) continue;
      const gen = p.status || "complete";
      const reviewable = ["complete", "awaiting_review", "pending", "in_review", "draft"].includes(gen);
      if (!reviewable) continue;
      const reviewStatus = ["approved", "changes_requested"].includes(p.reviewStatus)
        ? p.reviewStatus
        : "awaiting_review";
      queue.push({
        id: p.id,
        type: "Security Program",
        label: p.sections?.riskOverview?.postureLevel
          ? `Program — ${p.sections.riskOverview.postureLevel} posture`
          : "Security Program",
        status: reviewStatus,
        generatedAt: p.meta?.generatedAt || p.createdAt,
        kind: "program",
      });
    }

    // Policy documents: reviewStatus drives the queue state.
    for (const pd of db.data.policyDocs || []) {
      if (pd.userId !== clientId) continue;
      const reviewStatus = ["approved", "changes_requested"].includes(pd.reviewStatus)
        ? pd.reviewStatus
        : "awaiting_review";
      queue.push({
        id: pd.id,
        type: "Policy",
        label: pd.policyName || "Policy document",
        status: reviewStatus,
        generatedAt: pd.createdAt,
        kind: "policy",
      });
    }

    queue.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    res.json({ clientId, queue });
  });

  // ── Phase 3c: client security work (programs / assessments / policies) ──
  // These let an assigned analyst READ the same security artifacts the client
  // admin sees — scoped by assignment, read-only. Shapes mirror the client
  // endpoints in server.js so the frontend can reuse its existing renderers.

  // List a client's programs (summary rows).
  app.get("/api/analyst/clients/:id/programs", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const rows = (db.data.programs || [])
      .filter(p => p.userId === clientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(p => ({
        id: p.id,
        assessmentId: p.assessmentId,
        createdAt: p.createdAt,
        status: p.status,
        reviewStatus: p.reviewStatus || null,
        postureScore: p.sections?.riskOverview?.postureScore ?? null,
        postureLevel: p.sections?.riskOverview?.postureLevel ?? null,
      }));
    res.json(rows);
  });

  // Full program detail (the whole sections payload the client admin sees).
  app.get("/api/analyst/clients/:id/programs/:programId", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const program = (db.data.programs || []).find(
      p => p.id === req.params.programId && p.userId === clientId
    );
    if (!program) return res.status(404).json({ error: "Program not found." });
    res.json(program);
  });

  // List a client's assessments (summary rows).
  app.get("/api/analyst/clients/:id/assessments", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const rows = (db.data.assessments || [])
      .filter(a => a.userId === clientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(a => ({
        id: a.id,
        createdAt: a.createdAt,
        company: a.data?.company || null,
        compliance: a.data?.compliance || [],
      }));
    res.json(rows);
  });

  // Full assessment detail.
  app.get("/api/analyst/clients/:id/assessments/:assessmentId", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const a = (db.data.assessments || []).find(
      x => x.id === req.params.assessmentId && x.userId === clientId
    );
    if (!a) return res.status(404).json({ error: "Assessment not found." });
    res.json(a);
  });

  // List a client's policy documents (summary rows).
  app.get("/api/analyst/clients/:id/policies", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const rows = (db.data.policyDocs || [])
      .filter(p => p.userId === clientId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(p => ({
        id: p.id,
        policyId: p.policyId,
        policyName: p.policyName,
        status: p.status || "draft",
        reviewStatus: p.reviewStatus || null,
        createdAt: p.createdAt,
      }));
    res.json(rows);
  });

  // Full policy document detail (includes content).
  app.get("/api/analyst/clients/:id/policies/:policyDocId", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const doc = (db.data.policyDocs || []).find(
      p => p.id === req.params.policyDocId && p.userId === clientId
    );
    if (!doc) return res.status(404).json({ error: "Policy document not found." });
    res.json(doc);
  });

  // ── Phase 3d: analyst WRITE — approve / request changes on review items ──
  // Sets a review status on a program or policy document and records an audit
  // entry via logClientAction. Assignment-scoped; analysts act only on their
  // own clients. This is the write action behind the review-queue buttons.
  //
  // POST body: { kind: "program"|"policy", id, decision: "approve"|"request_changes", note? }
  app.post("/api/analyst/clients/:id/review-decision", requireAnalyst, async (req, res) => {
    const clientId = req.params.id;
    if (!canSee(req, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const { kind, id, decision, note } = req.body || {};
    if (!["program", "policy"].includes(kind)) {
      return res.status(400).json({ error: "kind must be 'program' or 'policy'." });
    }
    if (!id) return res.status(400).json({ error: "id is required." });
    if (!["approve", "request_changes"].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'approve' or 'request_changes'." });
    }

    const newStatus = decision === "approve" ? "approved" : "changes_requested";

    // Locate the target item, scoped to this client.
    const item = kind === "program"
      ? (db.data.programs || []).find(p => p.id === id && p.userId === clientId)
      : (db.data.policyDocs || []).find(p => p.id === id && p.userId === clientId);
    if (!item) return res.status(404).json({ error: `${kind} not found for this client.` });

    // Apply the review decision. IMPORTANT: programs use a SEPARATE reviewStatus
    // field so we never clobber the generation `status` ("complete"), which the
    // client's own views depend on. Policies have no such conflict, but we use
    // reviewStatus for them too for consistency.
    item.reviewStatus = newStatus;
    item.reviewedAt = nowIso();
    item.reviewedBy = req.userId;
    item.reviewHistory = item.reviewHistory || [];
    item.reviewHistory.push({
      at: nowIso(),
      analystUserId: req.userId,
      decision,
      note: (note || "").slice(0, 1000),
    });

    // Accountable audit entry in the shared client action log.
    const label = kind === "program" ? "Security program" : (item.policyName || "Policy");
    logClientAction(db, {
      clientUserId: clientId,
      actorUserId: req.userId,
      actorRole: "analyst",
      action: decision === "approve" ? "review_approved" : "review_changes_requested",
      detail: `${label} ${decision === "approve" ? "approved" : "sent back for changes"}${note ? `: ${note}` : "."}`,
    });

    // Notify the client so they see the outcome in their notification bell.
    if (decision === "approve") {
      pushNotification(db, {
        userId: clientId,
        type: "review_approved",
        title: `${label} approved`,
        body: note
          ? `Your ${label.toLowerCase()} was approved by your security analyst. Note: ${note}`
          : `Your ${label.toLowerCase()} was reviewed and approved by your security analyst.`,
        actorRole: "analyst",
      });
    } else {
      pushNotification(db, {
        userId: clientId,
        type: "review_changes_requested",
        title: `Changes requested on your ${label.toLowerCase()}`,
        body: note
          ? `Your security analyst requested changes: ${note}`
          : `Your security analyst requested changes to your ${label.toLowerCase()}.`,
        actorRole: "analyst",
      });
    }

    await db.write();
    res.json({ ok: true, kind, id, status: newStatus });
  });

  // ── Client notifications (the recipient's own login) ──
  // Any authenticated user can read + manage THEIR OWN notifications.
  app.get("/api/notifications", requireAuth, (req, res) => {
    const mine = (db.data.notifications || [])
      .filter(n => n.userId === req.userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 50);
    const unread = mine.filter(n => !n.read).length;
    res.json({ unread, notifications: mine });
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res) => {
    const n = (db.data.notifications || []).find(
      x => x.id === req.params.id && x.userId === req.userId
    );
    if (!n) return res.status(404).json({ error: "Notification not found." });
    n.read = true;
    await db.write();
    res.json({ ok: true });
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    let count = 0;
    for (const n of db.data.notifications || []) {
      if (n.userId === req.userId && !n.read) { n.read = true; count++; }
    }
    await db.write();
    res.json({ ok: true, marked: count });
  });

  console.log("ShieldAI portfolio routes registered.");
}
