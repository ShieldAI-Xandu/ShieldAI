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
// Access model (updated — this used to match portfolioRoutes.js's strict
// per-analyst isolation, it no longer does for viewing/replying/resolving):
// admins see every non-staff client's requests, as before. Analysts can now
// also view/reply-to/resolve ANY real client's ticket, not just their own
// assigned clients — a deliberate, scoped exception (see canSee's own
// comment below) so one analyst can cover another's queue; the "My
// Clients / Other Clients / All" scope toggle controls what's shown by
// default, not what's reachable. The one place isolation is still fully
// enforced is opening a NEW ticket "on behalf of" a client — that stays
// restricted to analystOwnsClient, unchanged (see the create route below).
// Analysts can also open internal (non-client) tickets, visible only to
// admins and the analyst who created them.

import { randomUUID } from "crypto";
import { logClientAction } from "./assignmentRoutes.js";
import { pushNotification } from "./portfolioRoutes.js";

const nowIso = () => new Date().toISOString();

export function registerSupportRoutes(app, { db, requireAuth, analystClientIds, analystOwnsClient, gate }) {
  // { id, clientUserId (nullable — null = internal/staff-only issue, not
  //   tied to a client), topic, status, createdAt, updatedAt,
  //   createdByUserId, createdByRole: "client"|"analyst"|"admin",
  //   escalated, escalatedAt, escalatedByUserId, escalatedNote,
  //   messages:[{id,authorRole,authorId,authorLabel,body,at}] }
  // Missing createdByRole on an existing record implies "client"; missing
  // escalated implies false — both are additive, pre-existing tickets are
  // unaffected.
  db.data.supportRequests ||= [];

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

  // Can this staff member see/reply-to/resolve this client's requests?
  //
  // Deliberately broader than the general analyst-isolation boundary: any
  // admin OR analyst may view/reply/resolve any real client's *support
  // ticket*, not just their own assigned clients, so one analyst can cover
  // another's queue. This is a narrow, explicit exception scoped to support
  // requests only — it does NOT apply to opening a new ticket "on behalf
  // of" a client (see the create-on-behalf-of route below, which checks
  // analystOwnsClient directly), and does not touch any other
  // analyst-facing route (clients, recommendations, live fleet, etc.),
  // which remain strictly isolated per the usual rule.
  function canSee(req, clientId) {
    const u = findUser(clientId);
    return !!u && !u.isAdmin && !u.isAnalyst;
  }

  // Internal (non-client-tied) tickets stay narrower than client tickets:
  // visible/actionable by an admin, or by the analyst who created it — these
  // are staff-to-admin escalations, not a shared team inbox.
  function canSeeTicket(req, ticket) {
    if (ticket.clientUserId) return canSee(req, ticket.clientUserId);
    return isAdminReq(req) || ticket.createdByUserId === req.userId;
  }

  // `scope` powers the "My Clients / Other Clients / All" toggle: "mine"
  // (default) preserves today's isolated view; "others"/"all" are the new
  // cross-analyst visibility. No effect for admins, who already see every
  // client either way.
  function visibleClientIds(req, scope) {
    const allClients = users().filter(u => !u.isAdmin && !u.isAnalyst).map(u => u.id);
    if (isAdminReq(req)) return allClients;
    const mine = new Set(analystClientIds(db, req.userId));
    if (scope === "others") return allClients.filter(id => !mine.has(id));
    if (scope === "all") return allClients;
    return allClients.filter(id => mine.has(id));
  }

  // Internal tickets don't get the "others" cross-analyst widening (that's
  // for client tickets only, per the design above) — always admin-sees-all
  // or creator-sees-own, regardless of the scope toggle.
  function visibleInternalTickets(req) {
    const internal = db.data.supportRequests.filter(r => !r.clientUserId);
    if (isAdminReq(req)) return internal;
    return internal.filter(r => r.createdByUserId === req.userId);
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
    const scope = ["mine", "others", "all"].includes(req.query.scope) ? req.query.scope : "mine";
    const admin = isAdminReq(req);
    const myClientIds = new Set(analystClientIds(db, req.userId));
    const allowedClientIds = new Set(visibleClientIds(req, scope));
    const clientTickets = db.data.supportRequests.filter(r => r.clientUserId && allowedClientIds.has(r.clientUserId));
    const internalTickets = visibleInternalTickets(req);
    let list = [...clientTickets, ...internalTickets];
    const status = req.query.status;
    if (status === "open" || status === "resolved") list = list.filter(r => r.status === status);
    if (req.query.escalated === "true") list = list.filter(r => r.escalated);
    list = list.slice().sort(sortByUpdatedDesc).map(r => ({
      ...r,
      client: r.clientUserId
        ? (() => { const u = findUser(r.clientUserId); return u ? { id: u.id, name: u.companyName || u.email, email: u.email } : null; })()
        : null,
      mine: admin ? true : (r.clientUserId ? myClientIds.has(r.clientUserId) : r.createdByUserId === req.userId),
    }));
    res.json(list);
  });

  // Analyst/admin opens a new ticket — either on behalf of a specific client
  // (clientUserId set) or as an internal/staff-only issue (omitted).
  app.post("/api/analyst/support-requests", requireAnalyst, async (req, res) => {
    const clientUserId = req.body?.clientUserId || null;
    if (clientUserId) {
      // Opening a ticket "as" a client stays exactly as strict as the
      // general analyst-isolation boundary — unlike canSee above, this is
      // NOT widened to any analyst.
      if (!isAdminReq(req) && !analystOwnsClient(db, req.userId, clientUserId)) {
        return res.status(403).json({ error: "You can only open a request on behalf of a client assigned to you." });
      }
      const clientUser = findUser(clientUserId);
      if (!clientUser || clientUser.isAdmin || clientUser.isAnalyst) {
        return res.status(400).json({ error: "clientUserId must be a real client account." });
      }
    }
    const topic = (req.body?.topic || "Something else").trim().slice(0, 80);
    const message = (req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message is required." });
    if (message.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const actor = findUser(req.userId);
    const at = nowIso();
    const ticket = {
      id: randomUUID(),
      clientUserId,
      topic,
      status: "open",
      createdAt: at,
      updatedAt: at,
      createdByUserId: req.userId,
      createdByRole: req.isAdmin ? "admin" : "analyst",
      escalated: false,
      escalatedAt: null,
      escalatedByUserId: null,
      escalatedNote: null,
      messages: [{
        id: randomUUID(), authorRole: "staff", authorId: req.userId,
        authorLabel: actor?.companyName || actor?.email || "ShieldAI staff",
        body: message.slice(0, 2000), at,
      }],
    };
    db.data.supportRequests.push(ticket);

    if (clientUserId) {
      for (const staffId of staffContactsFor(clientUserId)) {
        if (staffId === req.userId) continue;
        pushNotification(db, {
          userId: staffId,
          type: "support_request",
          title: `New support request logged for ${findUser(clientUserId)?.companyName || "a client"}`,
          body: `${topic}: ${message.slice(0, 900)}`,
          actorRole: req.isAdmin ? "admin" : "analyst",
        });
      }
      logClientAction(db, {
        clientUserId,
        actorUserId: req.userId,
        actorRole: req.isAdmin ? "admin" : "analyst",
        action: "support_request_created",
        detail: `${topic}: ${message.length > 200 ? `${message.slice(0, 200)}…` : message}`,
      });
    } else {
      for (const admin of users().filter(u => u.isAdmin)) {
        pushNotification(db, {
          userId: admin.id,
          type: "support_request",
          title: `New internal support request from ${actor?.email || "a staff member"}`,
          body: `${topic}: ${message.slice(0, 900)}`,
          actorRole: req.isAdmin ? "admin" : "analyst",
        });
      }
    }
    await db.write();
    res.json(ticket);
  });

  // Escalate an existing ticket (client-tied or internal) to admin/super-admin
  // — bypasses staffContactsFor's normal assigned-analyst-only routing so
  // every admin gets notified regardless of who's assigned.
  app.post("/api/analyst/support-requests/:id/escalate", requireAnalyst, async (req, res) => {
    const ticket = findRequest(req.params.id);
    if (!ticket || !canSeeTicket(req, ticket)) {
      return res.status(404).json({ error: "Support request not found." });
    }
    const note = (req.body?.note || "").trim().slice(0, 1000);
    const actor = findUser(req.userId);
    const at = nowIso();
    ticket.escalated = true;
    ticket.escalatedAt = at;
    ticket.escalatedByUserId = req.userId;
    ticket.escalatedNote = note || null;
    ticket.messages.push({
      id: randomUUID(), authorRole: "staff", authorId: req.userId,
      authorLabel: actor?.companyName || actor?.email || "ShieldAI staff",
      body: note ? `⬆ Escalated to admin: ${note}` : "⬆ Escalated to admin.",
      at,
    });
    ticket.updatedAt = at;

    for (const admin of users().filter(u => u.isAdmin)) {
      pushNotification(db, {
        userId: admin.id,
        type: "support_request",
        title: `Support request escalated by ${actor?.email || "a staff member"}`,
        body: note || ticket.topic,
        actorRole: req.isAdmin ? "admin" : "analyst",
      });
    }
    await db.write();
    res.json(ticket);
  });

  app.post("/api/analyst/support-requests/:id/reply", requireAnalyst, async (req, res) => {
    const ticket = findRequest(req.params.id);
    if (!ticket || !canSeeTicket(req, ticket)) {
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
    if (!ticket || !canSeeTicket(req, ticket)) {
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
