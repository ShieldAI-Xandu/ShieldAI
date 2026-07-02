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

const nowIso = () => new Date().toISOString();

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
  { db, analystClientIds, analystOwnsClient }
) {
  db.data.postureSnapshots ||= [];

  // Analyst-or-admin gate (self-contained; matches the pattern used by the
  // other analyst routes so we don't depend on a shared middleware export).
  function requireAnalyst(req, res, next) {
    if (!req.userId) return res.status(401).json({ error: "Not authenticated." });
    const u = (db.data.users || []).find(x => x.id === req.userId);
    if (!u || (!u.isAnalyst && !u.isAdmin)) {
      return res.status(403).json({ error: "Analyst access required." });
    }
    req.isAdmin = !!u.isAdmin;
    next();
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

  // Latest scored program for a user → posture score/level + weakest areas.
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
        };
      }
    }
    return null;
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
  function deriveStatus(posture, health, openRecs) {
    if (health.status === "offline") return "attention";
    if (posture && posture.score < 40) return "attention";
    if (openRecs > 0) return "needs_review";
    if (posture && posture.score < 60) return "needs_review";
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
          agent: health,
          openItems: openRecs,
          status: deriveStatus(posture, health, openRecs),
          hasProgram: !!posture,
        };
      })
      .filter(Boolean)
      // Attention first, then by weakest posture.
      .sort((a, b) => {
        const rank = s => (s === "attention" ? 0 : s === "needs_review" ? 1 : 2);
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

    // Programs whose status indicates they await analyst review/approval.
    for (const p of db.data.programs || []) {
      if (p.userId !== clientId) continue;
      const status = p.status || "complete";
      if (["awaiting_review", "pending", "in_review", "draft"].includes(status)) {
        queue.push({
          id: p.id,
          type: "Security Program",
          label: p.sections?.riskOverview?.postureLevel
            ? `Program — ${p.sections.riskOverview.postureLevel} posture`
            : "Security Program",
          status: "awaiting_review",
          generatedAt: p.meta?.generatedAt || p.createdAt,
          kind: "program",
        });
      }
    }

    // Policy documents not yet marked approved.
    for (const pd of db.data.policyDocs || []) {
      if (pd.userId !== clientId) continue;
      const status = pd.status || "draft";
      if (status !== "approved") {
        queue.push({
          id: pd.id,
          type: "Policy",
          label: pd.policyName || "Policy document",
          status: status === "draft" ? "awaiting_review" : status,
          generatedAt: pd.createdAt,
          kind: "policy",
        });
      }
    }

    queue.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
    res.json({ clientId, queue });
  });

  console.log("ShieldAI portfolio routes registered.");
}
