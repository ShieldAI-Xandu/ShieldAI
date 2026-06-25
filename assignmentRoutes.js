// assignmentRoutes.js
// Client↔analyst assignments and the client action log.
//
// Model: an admin assigns clients to analysts. An analyst has full control over
// the SECURITY WORK of clients assigned to them (endpoints, recommendations,
// analysis, action history) — but NOT administrative functions (billing, roles,
// tiers, account deletion), which remain admin-only. This is enforced by
// scoping analyst reads/writes to their assigned clients.
//
// Also records a per-client "action log": meaningful actions taken on/by a
// client (e.g. recommendation decisions, completions), queryable by the
// assigned analyst and by Mastermind.
//
// Exports:
//   registerAssignmentRoutes(app, { db, requireAuth, requireAdmin })
//   logClientAction(db, {...})        // call from other modules
//   analystClientIds(db, analystId)   // ids an analyst is assigned to
//   analystOwnsClient(db, analystId, clientId)

import { randomUUID } from "crypto";
const nowIso = () => new Date().toISOString();

// Record a client-related action. Safe to call from anywhere with db in hand.
export function logClientAction(db, { clientUserId, actorUserId, actorRole, action, detail, recommendationId }) {
  db.data.clientActions ||= [];
  db.data.clientActions.push({
    id: randomUUID(),
    clientUserId,
    actorUserId: actorUserId || null,
    actorRole: actorRole || "system",   // client_admin | analyst | admin | ai | system
    action,
    detail: detail || "",
    recommendationId: recommendationId || null,
    at: nowIso(),
  });
  // keep it from growing unbounded
  if (db.data.clientActions.length > 5000) {
    db.data.clientActions = db.data.clientActions.slice(-5000);
  }
}

export function analystClientIds(db, analystId) {
  return (db.data.assignments || [])
    .filter(a => a.analystUserId === analystId)
    .map(a => a.clientUserId);
}

export function analystOwnsClient(db, analystId, clientId) {
  return (db.data.assignments || []).some(a => a.analystUserId === analystId && a.clientUserId === clientId);
}

export function registerAssignmentRoutes(app, { db, requireAuth, requireAdmin }) {
  db.data.assignments ||= [];
  db.data.clientActions ||= [];

  const users = () => db.data.users || [];
  const findUser = (id) => users().find(u => u.id === id);
  const nameOf = (id) => { const u = findUser(id); return u ? (u.companyName || u.email) : "—"; };

  // analyst-or-admin guard
  function requireAnalyst(req, res, next) {
    requireAuth(req, res, () => {
      if (!req.isAnalyst && !req.isAdmin) return res.status(403).json({ error: "Analyst access required." });
      next();
    });
  }

  // ── ADMIN: assignment management ────────────────────────────

  // List all assignments (admin), grouped by analyst.
  app.get("/api/admin/assignments", requireAdmin, (req, res) => {
    const analysts = users().filter(u => u.isAnalyst);
    const out = analysts.map(an => ({
      analystUserId: an.id,
      analyst: an.companyName || an.email,
      email: an.email,
      clients: analystClientIds(db, an.id).map(cid => ({ id: cid, name: nameOf(cid) })),
    }));
    // also surface unassigned clients (standard accounts with no analyst)
    const assignedSet = new Set((db.data.assignments || []).map(a => a.clientUserId));
    const unassigned = users()
      .filter(u => !u.isAdmin && !u.isAnalyst && !assignedSet.has(u.id))
      .map(u => ({ id: u.id, name: u.companyName || u.email }));
    res.json({ analysts: out, unassigned });
  });

  // Assign a client to an analyst.
  app.post("/api/admin/assignments", requireAdmin, async (req, res) => {
    const { analystUserId, clientUserId } = req.body || {};
    const an = findUser(analystUserId), cl = findUser(clientUserId);
    if (!an || !an.isAnalyst) return res.status(400).json({ error: "analystUserId must be an analyst account." });
    if (!cl) return res.status(404).json({ error: "Client not found." });
    if (cl.isAdmin) return res.status(400).json({ error: "Cannot assign an admin account as a client." });

    if (analystOwnsClient(db, analystUserId, clientUserId)) {
      return res.status(409).json({ error: "Already assigned." });
    }
    db.data.assignments.push({
      id: randomUUID(), analystUserId, clientUserId,
      assignedBy: req.userId, assignedAt: nowIso(),
    });
    logClientAction(db, { clientUserId, actorUserId: req.userId, actorRole: "admin",
      action: "assigned_analyst", detail: `Assigned to analyst ${an.companyName || an.email}.` });
    await db.write();
    res.json({ ok: true, analystUserId, clientUserId });
  });

  // Unassign.
  app.delete("/api/admin/assignments", requireAdmin, async (req, res) => {
    const { analystUserId, clientUserId } = req.body || {};
    const before = (db.data.assignments || []).length;
    db.data.assignments = (db.data.assignments || []).filter(
      a => !(a.analystUserId === analystUserId && a.clientUserId === clientUserId));
    if (db.data.assignments.length === before) return res.status(404).json({ error: "Assignment not found." });
    const an = findUser(analystUserId);
    logClientAction(db, { clientUserId, actorUserId: req.userId, actorRole: "admin",
      action: "unassigned_analyst", detail: `Unassigned from analyst ${an ? (an.companyName || an.email) : analystUserId}.` });
    await db.write();
    res.json({ ok: true });
  });

  // ── ANALYST: my assigned clients ────────────────────────────
  app.get("/api/analyst/clients", requireAnalyst, (req, res) => {
    // Admins see all clients; analysts see only assigned ones.
    const ids = req.isAdmin
      ? users().filter(u => !u.isAdmin).map(u => u.id)
      : analystClientIds(db, req.userId);
    const agents = db.data.agents || [];
    const recs = db.data.recommendations || [];
    const out = ids.map(cid => {
      const u = findUser(cid);
      if (!u) return null;
      const myAgents = agents.filter(a => a.ownerUserId === cid && a.status !== "revoked");
      const openRecs = recs.filter(r => r.ownerUserId === cid && !["completed","declined"].includes(r.status)).length;
      return {
        id: cid, name: u.companyName || u.email, email: u.email,
        tier: u.tier || "free", endpoints: myAgents.length, openRecommendations: openRecs,
      };
    }).filter(Boolean);
    res.json(out);
  });

  // ── Client action history (analyst for assigned, admin for all) ──
  app.get("/api/analyst/clients/:id/actions", requireAnalyst, (req, res) => {
    const clientId = req.params.id;
    if (!req.isAdmin && !analystOwnsClient(db, req.userId, clientId)) {
      return res.status(403).json({ error: "This client is not assigned to you." });
    }
    const rows = (db.data.clientActions || [])
      .filter(a => a.clientUserId === clientId)
      .sort((x, y) => new Date(y.at) - new Date(x.at))
      .slice(0, 500);
    res.json({ client: nameOf(clientId), actions: rows });
  });

  console.log("ShieldAI assignment routes registered.");
}
