// supportRoutes.js
// In-app Support Center for signed-in clients (Starter+): submit a support
// request that becomes a trackable ticket, and get replies from whichever
// analyst/admin picks it up. Distinct from clientMessages (portfolioRoutes.js)
// which is one continuous thread with a client's specifically ASSIGNED
// analyst (Guided+) — a support request is a discrete ticket, reachable by
// any Starter+ client whether or not they have an assigned analyst yet, and
// visible to any analyst/admin allowed to see that client (not just an
// assigned one).
//
// Mount from server.js:
//   import { registerSupportRoutes } from "./supportRoutes.js";
//   registerSupportRoutes(app, { db, requireAuth, analystClientIds, analystOwnsClient, gate });
//
// Access model mirrors portfolioRoutes.js: admins see every non-staff
// client's requests; analysts see only requests from clients assigned to
// them (db.data.assignments, via analystOwnsClient/analystClientIds) — the
// same isolation boundary enforced everywhere else in the analyst console.

import { randomUUID } from "crypto";
import { logClientAction } from "./assignmentRoutes.js";
import { pushNotification } from "./portfolioRoutes.js";

const nowIso = () => new Date().toISOString();

export function registerSupportRoutes(app, { db, requireAuth, analystClientIds, analystOwnsClient, gate }) {
  db.data.supportRequests ||= []; // { id, clientUserId, topic, status, createdAt, updatedAt, messages:[{id,authorRole,authorId,authorLabel,body,at}] }

  // The real enforcement point — UI hiding (the top-bar button/upgrade prompt)
  // is cosmetic. Gates the whole Support Center, not just the Mastermind
  // option inside it: Free tier keeps using the public marketing-site
  // Support page instead.
  const supportCenterGate = gate ? gate.capability("supportCenter") : (req, res, next) => next();

  const users = () => db.data.users || [];
  const findUser = id => users().find(u => u.id === id) || null;

  function requireAnalyst(req, res, next) {
    requireAuth(req, res, () => {
      const u = findUser(req.userId);
      if (!u || (!u.isAnalyst && !u.isAdmin)) {
        return res.status(403).json({ error: "Analyst access required." });
      }
      req.isAdmin = !!u.isAdmin;
      next();
    });
  }

  function isAdminReq(req) {
    const u = findUser(req.userId);
    return !!(u && u.isAdmin);
  }

  // Can this staff member see this client's requests?
  function canSee(req, clientId) {
    if (isAdminReq(req)) {
      const u = findUser(clientId);
      return !!u && !u.isAdmin && !u.isAnalyst;
    }
    return analystOwnsClient(db, req.userId, clientId);
  }

  function visibleClientIds(req) {
    if (isAdminReq(req)) {
      return users().filter(u => !u.isAdmin && !u.isAnalyst).map(u => u.id);
    }
    return analystClientIds(db, req.userId);
  }

  // Who to notify when a client opens/replies to a ticket: their assigned
  // analyst(s), or every admin if nobody's assigned yet — mirrors
  // portfolioRoutes.js's staffContactsFor exactly, so a ticket is never
  // silently unseen just because assignment hasn't happened.
  function staffContactsFor(clientId) {
    const analystIds = (db.data.assignments || [])
      .filter(a => a.clientUserId === clientId)
      .map(a => a.analystUserId);
    if (analystIds.length) return analystIds;
    return users().filter(u => u.isAdmin).map(u => u.id);
  }

  function findRequest(id) {
    return db.data.supportRequests.find(r => r.id === id) || null;
  }

  const sortByUpdatedDesc = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);

  // ── Client side ──────────────────────────────────────────────
  app.get("/api/client/support-requests", requireAuth, supportCenterGate, (req, res) => {
    if (req.isAdmin || req.isAnalyst) return res.status(403).json({ error: "Client access only." });
    const mine = db.data.supportRequests
      .filter(r => r.clientUserId === req.userId)
      .sort(sortByUpdatedDesc);
    res.json(mine);
  });

  app.post("/api/client/support-requests", requireAuth, supportCenterGate, async (req, res) => {
    if (req.isAdmin || req.isAnalyst) return res.status(403).json({ error: "Client access only." });
    const topic = (req.body?.topic || "Something else").trim().slice(0, 80);
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });
    if (message.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const me = findUser(req.userId);
    const at = nowIso();
    const ticket = {
      id: randomUUID(),
      clientUserId: req.userId,
      topic,
      status: "open",
      createdAt: at,
      updatedAt: at,
      messages: [{
        id: randomUUID(), authorRole: "client", authorId: req.userId,
        authorLabel: me?.companyName || me?.email || "Client",
        body: message.slice(0, 2000), at,
      }],
    };
    db.data.supportRequests.push(ticket);

    for (const staffId of staffContactsFor(req.userId)) {
      pushNotification(db, {
        userId: staffId,
        type: "support_request",
        title: `New support request from ${me?.companyName || me?.email || "a client"}`,
        body: `${topic}: ${message.slice(0, 900)}`,
        actorRole: "client_admin",
      });
    }
    logClientAction(db, {
      clientUserId: req.userId,
      actorUserId: req.userId,
      actorRole: "client_admin",
      action: "support_request_created",
      detail: `${topic}: ${message.length > 200 ? `${message.slice(0, 200)}…` : message}`,
    });
    await db.write();
    res.json(ticket);
  });

  app.post("/api/client/support-requests/:id/reply", requireAuth, supportCenterGate, async (req, res) => {
    if (req.isAdmin || req.isAnalyst) return res.status(403).json({ error: "Client access only." });
    const ticket = findRequest(req.params.id);
    if (!ticket || ticket.clientUserId !== req.userId) {
      return res.status(404).json({ error: "Support request not found." });
    }
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });
    if (message.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const me = findUser(req.userId);
    const at = nowIso();
    ticket.messages.push({
      id: randomUUID(), authorRole: "client", authorId: req.userId,
      authorLabel: me?.companyName || me?.email || "Client",
      body: message.slice(0, 2000), at,
    });
    ticket.status = "open"; // a follow-up reopens a resolved ticket
    ticket.updatedAt = at;

    for (const staffId of staffContactsFor(req.userId)) {
      pushNotification(db, {
        userId: staffId,
        type: "support_request",
        title: `${me?.companyName || me?.email || "A client"} replied to their support request`,
        body: message.slice(0, 900),
        actorRole: "client_admin",
      });
    }
    await db.write();
    res.json(ticket);
  });

  // ── Staff side ───────────────────────────────────────────────
  app.get("/api/analyst/support-requests", requireAnalyst, (req, res) => {
    const allowed = new Set(visibleClientIds(req));
    let list = db.data.supportRequests.filter(r => allowed.has(r.clientUserId));
    const status = req.query.status;
    if (status === "open" || status === "resolved") list = list.filter(r => r.status === status);
    list = list.slice().sort(sortByUpdatedDesc).map(r => ({
      ...r,
      client: (() => { const u = findUser(r.clientUserId); return u ? { id: u.id, name: u.companyName || u.email, email: u.email } : null; })(),
    }));
    res.json(list);
  });

  app.post("/api/analyst/support-requests/:id/reply", requireAnalyst, async (req, res) => {
    const ticket = findRequest(req.params.id);
    if (!ticket || !canSee(req, ticket.clientUserId)) {
      return res.status(404).json({ error: "Support request not found." });
    }
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });
    if (message.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const actor = findUser(req.userId);
    const at = nowIso();
    ticket.messages.push({
      id: randomUUID(), authorRole: "staff", authorId: req.userId,
      authorLabel: actor?.companyName || actor?.email || "ShieldAI support",
      body: message.slice(0, 2000), at,
    });
    ticket.updatedAt = at;

    pushNotification(db, {
      userId: ticket.clientUserId,
      type: "support_reply",
      title: "New reply to your support request",
      body: message.slice(0, 1000),
      actorRole: req.isAdmin ? "admin" : "analyst",
    });
    logClientAction(db, {
      clientUserId: ticket.clientUserId,
      actorUserId: req.userId,
      actorRole: req.isAdmin ? "admin" : "analyst",
      action: "support_reply_sent",
      detail: message.length > 200 ? `${message.slice(0, 200)}…` : message,
    });
    await db.write();
    res.json(ticket);
  });

  app.patch("/api/analyst/support-requests/:id", requireAnalyst, async (req, res) => {
    const ticket = findRequest(req.params.id);
    if (!ticket || !canSee(req, ticket.clientUserId)) {
      return res.status(404).json({ error: "Support request not found." });
    }
    const status = req.body?.status;
    if (status !== "open" && status !== "resolved") {
      return res.status(400).json({ error: "status must be 'open' or 'resolved'." });
    }
    ticket.status = status;
    ticket.updatedAt = nowIso();
    await db.write();
    res.json(ticket);
  });
}
