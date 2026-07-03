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

    await db.write();
    res.json({ ok: true, kind, id, status: newStatus });
  });

  console.log("ShieldAI portfolio routes registered.");
}
