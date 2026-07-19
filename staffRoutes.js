// staffRoutes.js
// Staff (admin + assigned-analyst) access to a CLIENT's own security workspace.
//
// Why this module exists
// ----------------------
// Every workspace route in server.js is scoped to `a.userId === req.userId` —
// i.e. it only ever returns the LOGGED-IN user's own data. That is correct for
// clients, but it means an analyst (or admin) has no way to "see everything the
// client sees" or to fix/change a client's program on their behalf. This module
// adds a parallel, explicitly-scoped surface where the target is a CLIENT ID in
// the URL, authorized by:
//
//     req.isAdmin  OR  (req.isAnalyst AND analystOwnsClient(analyst, client))
//
// Client isolation is preserved: an analyst can only reach clients assigned to
// them. Admin can reach everyone. A standard client can reach NONE of these
// routes (they use their own self-scoped routes in server.js).
//
// Accountability: every mutating action is written to the client action log via
// logClientAction(actorRole = admin|analyst), so there's a full trail of what
// staff changed inside a client's workspace.
//
// Mount from server.js AFTER the self-scoped routes and BEFORE the SPA fallback:
//   import { registerStaffRoutes } from "./staffRoutes.js";
//   registerStaffRoutes(app, { db, requireAuth, logClientAction, analystOwnsClient });
//
// Route surface (all under /api/staff, all requireStaff + client-scope check):
//   GET   /api/staff/clients/:cid/overview          full snapshot for the drill-in
//   GET   /api/staff/clients/:cid/assessments
//   GET   /api/staff/clients/:cid/assessments/:id
//   PATCH /api/staff/clients/:cid/assessments/:id    edit company info + checklist
//   GET   /api/staff/clients/:cid/programs
//   GET   /api/staff/clients/:cid/programs/:id
//   DELETE/api/staff/clients/:cid/programs/:id
//   GET   /api/staff/clients/:cid/policies
//   GET   /api/staff/clients/:cid/policies/:id
//   PATCH /api/staff/clients/:cid/policies/:id        edit policy content
//   DELETE/api/staff/clients/:cid/policies/:id
//   GET   /api/staff/clients/:cid/training
//   GET   /api/staff/clients/:cid/training/:id

const nowIso = () => new Date().toISOString();

// Authorize a staff user (admin or owning-analyst) for a specific client.
// Returns { ok: true, client } on success, or { ok: false, status, error } so
// the caller can respond. Shared by this module's routes AND by the staff
// program-generation route that lives in server.js (next to the pipeline).
// Requires req.isAdmin / req.isAnalyst / req.userId to already be set (i.e.
// call after requireAuth).
export function authorizeStaffForClient(db, req, clientId, analystOwnsClient) {
  if (!req.isAdmin && !req.isAnalyst) {
    return { ok: false, status: 403, error: "Staff access required." };
  }
  const client = (db.data.users || []).find(u => u.id === clientId);
  if (!client) return { ok: false, status: 404, error: "Client not found." };
  if (client.isAdmin) return { ok: false, status: 400, error: "That account is an admin, not a client." };
  const allowed = req.isAdmin || (req.isAnalyst && analystOwnsClient && analystOwnsClient(db, req.userId, clientId));
  if (!allowed) return { ok: false, status: 403, error: "This client is not assigned to you." };
  return { ok: true, client };
}

export function registerStaffRoutes(app, { db, requireAuth, logClientAction, analystOwnsClient }) {
  const findUser = (id) => (db.data.users || []).find(u => u.id === id);

  // ── Guards ──────────────────────────────────────────────────
  // Staff = admin OR analyst. Anyone else is rejected before scope checks.
  function requireStaff(req, res, next) {
    requireAuth(req, res, () => {
      if (!req.isAdmin && !req.isAnalyst) {
        return res.status(403).json({ error: "Staff access required." });
      }
      next();
    });
  }

  // Resolve + authorize the target client from :cid. On success, attaches
  // req.client and calls next(); on failure, responds and returns.
  // Admin reaches any client; analyst reaches only assigned clients.
  function withClient(req, res, next) {
    const result = authorizeStaffForClient(db, req, req.params.cid, analystOwnsClient);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    req.client = result.client;
    next();
  }

  // Convenience: chain requireStaff + withClient for every route.
  const staff = [requireStaff, withClient];

  // Role string for the action log.
  const actorRole = (req) => (req.isAdmin ? "admin" : "analyst");

  // ── Overview snapshot (powers the "View as client" drill-in) ─
  app.get("/api/staff/clients/:cid/overview", ...staff, (req, res) => {
    const cid = req.client.id;
    const assessments = (db.data.assessments || [])
      .filter(a => a.userId === cid)
      .map(a => ({ id: a.id, createdAt: a.createdAt, updatedAt: a.updatedAt || null, company: a.data?.company || {} }));
    const programs = (db.data.programs || [])
      .filter(p => p.userId === cid)
      .map(p => ({ id: p.id, assessmentId: p.assessmentId || null, createdAt: p.createdAt, status: p.status }));
    const policies = (db.data.policyDocs || [])
      .filter(p => p.userId === cid)
      .map(p => ({ id: p.id, policyId: p.policyId, policyName: p.policyName, createdAt: p.createdAt, updatedAt: p.updatedAt || null }));
    const training = (db.data.trainingPrograms || [])
      .filter(t => t.userId === cid)
      .map(t => ({ id: t.id, createdAt: t.createdAt, companyContext: t.companyContext,
        moduleCount: (t.curriculum?.phases || []).reduce((s, p) => s + (p.modules?.length || 0), 0) }));
    const endpoints = (db.data.agents || [])
      .filter(a => a.ownerUserId === cid && a.status !== "revoked").length;
    const openRecommendations = (db.data.recommendations || [])
      .filter(r => r.ownerUserId === cid && !["completed", "declined"].includes(r.status)).length;

    res.json({
      client: {
        id: req.client.id,
        name: req.client.companyName || req.client.email,
        email: req.client.email,
        tier: req.client.tier || "free",
        suspended: !!req.client.suspended,
      },
      counts: {
        assessments: assessments.length,
        programs: programs.length,
        policies: policies.length,
        training: training.length,
        endpoints,
        openRecommendations,
      },
      assessments, programs, policies, training,
    });
  });

  // ── Assessments ─────────────────────────────────────────────
  app.get("/api/staff/clients/:cid/assessments", ...staff, (req, res) => {
    const list = (db.data.assessments || [])
      .filter(a => a.userId === req.client.id)
      .map(a => ({ id: a.id, createdAt: a.createdAt, updatedAt: a.updatedAt || null, company: a.data?.company || {} }));
    res.json(list);
  });

  app.get("/api/staff/clients/:cid/assessments/:id", ...staff, (req, res) => {
    const record = (db.data.assessments || []).find(a => a.id === req.params.id && a.userId === req.client.id);
    if (!record) return res.status(404).json({ error: "Assessment not found" });
    res.json(record);
  });

  // Edit a client's assessment on their behalf (company info + checklist).
  app.patch("/api/staff/clients/:cid/assessments/:id", ...staff, async (req, res) => {
    const record = (db.data.assessments || []).find(a => a.id === req.params.id && a.userId === req.client.id);
    if (!record) return res.status(404).json({ error: "Assessment not found" });
    if (req.body.data && typeof req.body.data === "object") {
      record.data = { ...record.data, ...req.body.data };
    }
    record.updatedAt = nowIso();
    logClientAction(db, {
      clientUserId: req.client.id, actorUserId: req.userId, actorRole: actorRole(req),
      action: "edited_assessment", detail: `Edited assessment ${record.id} on behalf of client.`,
    });
    await db.write();
    res.json({ ok: true, id: record.id, data: record.data });
  });

  // ── Programs ────────────────────────────────────────────────
  app.get("/api/staff/clients/:cid/programs", ...staff, (req, res) => {
    const list = (db.data.programs || [])
      .filter(p => p.userId === req.client.id)
      .map(p => ({ id: p.id, assessmentId: p.assessmentId || null, createdAt: p.createdAt, status: p.status }));
    res.json(list);
  });

  app.get("/api/staff/clients/:cid/programs/:id", ...staff, (req, res) => {
    const program = (db.data.programs || []).find(p => p.id === req.params.id && p.userId === req.client.id);
    if (!program) return res.status(404).json({ error: "Program not found" });
    res.json(program);
  });

  // Delete a client's program on their behalf (e.g. clearing a bad/stuck one
  // so it can be regenerated). Non-destructive to assessments.
  app.delete("/api/staff/clients/:cid/programs/:id", ...staff, async (req, res) => {
    const before = (db.data.programs || []).length;
    db.data.programs = (db.data.programs || []).filter(
      p => !(p.id === req.params.id && p.userId === req.client.id)
    );
    if (db.data.programs.length === before) return res.status(404).json({ error: "Program not found" });
    logClientAction(db, {
      clientUserId: req.client.id, actorUserId: req.userId, actorRole: actorRole(req),
      action: "deleted_program", detail: `Deleted program ${req.params.id} on behalf of client.`,
    });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // ── Policies ────────────────────────────────────────────────
  app.get("/api/staff/clients/:cid/policies", ...staff, (req, res) => {
    const list = (db.data.policyDocs || [])
      .filter(p => p.userId === req.client.id)
      .map(p => ({ id: p.id, policyId: p.policyId, policyName: p.policyName, createdAt: p.createdAt, updatedAt: p.updatedAt || null }));
    res.json(list);
  });

  app.get("/api/staff/clients/:cid/policies/:id", ...staff, (req, res) => {
    const record = (db.data.policyDocs || []).find(p => p.id === req.params.id && p.userId === req.client.id);
    if (!record) return res.status(404).json({ error: "Policy document not found" });
    res.json(record);
  });

  // Edit a client's policy content on their behalf. Only the editable fields
  // (content, and optionally policyName) are touched; provenance is preserved.
  app.patch("/api/staff/clients/:cid/policies/:id", ...staff, async (req, res) => {
    const record = (db.data.policyDocs || []).find(p => p.id === req.params.id && p.userId === req.client.id);
    if (!record) return res.status(404).json({ error: "Policy document not found" });
    const { content, policyName } = req.body || {};
    if (typeof content === "string") record.content = content;
    if (typeof policyName === "string" && policyName.trim()) record.policyName = policyName.trim();
    record.updatedAt = nowIso();
    record.lastEditedBy = req.userId;
    logClientAction(db, {
      clientUserId: req.client.id, actorUserId: req.userId, actorRole: actorRole(req),
      action: "edited_policy", detail: `Edited policy "${record.policyName}" (${record.id}) on behalf of client.`,
    });
    await db.write();
    res.json({ ok: true, id: record.id, policyName: record.policyName, content: record.content });
  });

  app.delete("/api/staff/clients/:cid/policies/:id", ...staff, async (req, res) => {
    const before = (db.data.policyDocs || []).length;
    db.data.policyDocs = (db.data.policyDocs || []).filter(
      p => !(p.id === req.params.id && p.userId === req.client.id)
    );
    if (db.data.policyDocs.length === before) return res.status(404).json({ error: "Policy document not found" });
    logClientAction(db, {
      clientUserId: req.client.id, actorUserId: req.userId, actorRole: actorRole(req),
      action: "deleted_policy", detail: `Deleted policy ${req.params.id} on behalf of client.`,
    });
    await db.write();
    res.json({ ok: true, deleted: req.params.id });
  });

  // ── Training ────────────────────────────────────────────────
  app.get("/api/staff/clients/:cid/training", ...staff, (req, res) => {
    const list = (db.data.trainingPrograms || [])
      .filter(t => t.userId === req.client.id)
      .map(t => ({ id: t.id, createdAt: t.createdAt, companyContext: t.companyContext,
        moduleCount: (t.curriculum?.phases || []).reduce((s, p) => s + (p.modules?.length || 0), 0) }));
    res.json(list);
  });

  app.get("/api/staff/clients/:cid/training/:id", ...staff, (req, res) => {
    const record = (db.data.trainingPrograms || []).find(t => t.id === req.params.id && t.userId === req.client.id);
    if (!record) return res.status(404).json({ error: "Training program not found" });
    res.json(record);
  });

  console.log("ShieldAI staff client-workspace routes registered.");
}
