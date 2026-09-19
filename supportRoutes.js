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

export function registerSupportRoutes(app, { db, requireAuth, analystClientIds, analystOwnsClient, gate, callClaudeWithTools }) {
  // { id, clientUserId (nullable — null = internal/staff-only issue, not
  //   tied to a client), topic, status, createdAt, updatedAt,
  //   createdByUserId, createdByRole: "client"|"analyst"|"admin",
  //   escalated, escalatedAt, escalatedByUserId, escalatedNote,
  //   humanRequested, humanRequestedAt, humanRequestedBy: "client"|"mastermind"|"staff"|null,
  //   claimedByUserId, claimedByRole: "admin"|"analyst"|null, claimedAt,
  //   messages:[{id,authorRole: "client"|"staff"|"mastermind",authorId,authorLabel,body,at}] }
  // Missing createdByRole on an existing record implies "client"; missing
  // escalated/humanRequested/claimedByUserId implies false/null — all
  // additive, pre-existing tickets are unaffected.
  //
  // Unified support chat: while a ticket is unclaimed, a client message is
  // answered by Mastermind automatically (maybeGenerateMastermindReply,
  // below) — "Mastermind is always the first option." A client can ask for
  // a person explicitly (request-human route) or Mastermind can flag it
  // itself via the request_human_support tool; either way every admin and
  // analyst is notified and the first to /claim becomes the sole active
  // handler (single-claim — others can still view via canSee's existing
  // cross-analyst visibility, but there's one clear owner). Any ticket a
  // staff member creates or replies to is auto-claimed by them, so
  // Mastermind never talks over a human who's already engaged.
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

  // Flags a ticket for human pickup and notifies EVERY admin+analyst (not
  // just assigned ones — matches the "all analysts and admins should be
  // able to join" requirement). No-op if already flagged, so a chatty
  // client re-asking "can I talk to a person" doesn't re-notify everyone.
  function flagHumanRequested(ticket, { requestedBy, note }) {
    if (ticket.humanRequested) return;
    ticket.humanRequested = true;
    ticket.humanRequestedAt = nowIso();
    ticket.humanRequestedBy = requestedBy;
    const staffIds = users().filter(u => u.isAdmin || u.isAnalyst).map(u => u.id);
    for (const staffId of staffIds) {
      pushNotification(db, {
        userId: staffId,
        type: "support_human_requested",
        title: `${ticket.topic} — a client wants to talk to a person`,
        body: note || "Open the Chats page to join this conversation.",
        actorRole: requestedBy === "mastermind" ? "system" : "client_admin",
      });
    }
  }

  const SUPPORT_CHAT_TOOLS = [
    {
      name: "request_human_support",
      description: "Flag this support conversation for a human admin/analyst to join, when the client explicitly asks for a person or you can't resolve their issue yourself.",
      input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
    {
      name: "check_my_support_status",
      description: "Check whether a human has claimed this conversation yet, and who (if anyone) requested one.",
      input_schema: { type: "object", properties: {} },
    },
  ];

  // Mastermind-first behavior: while a ticket is unclaimed, run the
  // client's latest message through Claude with a tiny, ticket-scoped tool
  // pair (never the staff/platform-wide MASTERMIND_TOOLS — this must never
  // be able to see or touch another client's data). Appends the reply as
  // authorRole:"mastermind" and returns true on success; returns false
  // (never throws) if Mastermind isn't configured or the call fails, so
  // the caller can fall back to notifying staff directly rather than
  // letting a client's message go unanswered AND unseen.
  async function maybeGenerateMastermindReply(ticket) {
    if (!callClaudeWithTools || ticket.claimedByUserId) return false;

    const history = ticket.messages.slice(-10).map(m => ({
      role: m.authorRole === "client" ? "user" : "assistant",
      content: m.body,
    }));
    if (!history.length || history[0].role !== "user") return false;

    const system = `You are Mastermind, ShieldAI's AI security advisor, answering inside a client's support chat.
Be concise, direct, and helpful — you're the first line of support, not a human, and must never imply otherwise.
If the client asks to speak with a person, or the issue is something you genuinely can't resolve (billing disputes, account changes, anything needing human judgment), call request_human_support with a short reason.
You have no ability to change account settings, billing, or any client data from this chat — for anything beyond answering a question, request a human instead of guessing.`;

    let replyText = null;
    try {
      replyText = await callClaudeWithTools({
        system,
        messages: history,
        tools: SUPPORT_CHAT_TOOLS,
        maxTurns: 3,
        runTool: async (name, input) => {
          if (name === "request_human_support") {
            flagHumanRequested(ticket, { requestedBy: "mastermind", note: input?.reason });
            return { ok: true, note: "A human has been notified and will join shortly." };
          }
          if (name === "check_my_support_status") {
            const claimant = ticket.claimedByUserId ? findUser(ticket.claimedByUserId) : null;
            return {
              humanRequested: !!ticket.humanRequested,
              claimed: !!ticket.claimedByUserId,
              claimedByLabel: claimant ? (claimant.companyName || claimant.email) : null,
            };
          }
          return { error: `Unknown tool "${name}".` };
        },
      });
    } catch (err) {
      console.warn("Mastermind support-chat reply failed:", err.message);
      return false;
    }

    if (!replyText || !replyText.trim()) return false;
    ticket.messages.push({
      id: randomUUID(), authorRole: "mastermind", authorId: null,
      authorLabel: "Mastermind (AI)",
      body: replyText.trim().slice(0, 4000),
      at: nowIso(),
    });
    ticket.updatedAt = nowIso();
    return true;
  }

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
      humanRequested: false,
      humanRequestedAt: null,
      humanRequestedBy: null,
      claimedByUserId: null,
      claimedByRole: null,
      claimedAt: null,
      messages: [{
        id: randomUUID(), authorRole: "client", authorId: req.userId,
        authorLabel: me?.companyName || me?.email || "Client",
        body: message.slice(0, 2000), at,
      }],
    };
    db.data.supportRequests.push(ticket);

    // Mastermind-first: try an AI reply before paging any human. Only fall
    // back to notifying staff if Mastermind isn't configured or fails —
    // a client's message must never go both unanswered and unseen.
    const mastermindReplied = await maybeGenerateMastermindReply(ticket);
    if (!mastermindReplied) {
      for (const staffId of staffContactsFor(req.userId)) {
        pushNotification(db, {
          userId: staffId,
          type: "support_request",
          title: `New support request from ${me?.companyName || me?.email || "a client"}`,
          body: `${topic}: ${message.slice(0, 900)}`,
          actorRole: "client_admin",
        });
      }
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

    if (ticket.claimedByUserId) {
      // A human already owns this conversation — notify them directly,
      // Mastermind stays out of it.
      pushNotification(db, {
        userId: ticket.claimedByUserId,
        type: "support_request",
        title: `${me?.companyName || me?.email || "A client"} replied to their support request`,
        body: message.slice(0, 900),
        actorRole: "client_admin",
      });
    } else {
      const mastermindReplied = await maybeGenerateMastermindReply(ticket);
      if (!mastermindReplied) {
        for (const staffId of staffContactsFor(req.userId)) {
          pushNotification(db, {
            userId: staffId,
            type: "support_request",
            title: `${me?.companyName || me?.email || "A client"} replied to their support request`,
            body: message.slice(0, 900),
            actorRole: "client_admin",
          });
        }
      }
    }
    await db.write();
    res.json(ticket);
  });

  // Explicit "Talk to a person" button — the client-initiated counterpart
  // to Mastermind's own request_human_support tool call. Both converge on
  // the same flagHumanRequested() helper, so a pending-join banner and
  // staff notification look identical regardless of which path triggered it.
  app.post("/api/client/support-requests/:id/request-human", requireAuth, supportCenterGate, async (req, res) => {
    if (req.isAdmin || req.isAnalyst) return res.status(403).json({ error: "Client access only." });
    const ticket = findRequest(req.params.id);
    if (!ticket || ticket.clientUserId !== req.userId) {
      return res.status(404).json({ error: "Support request not found." });
    }
    flagHumanRequested(ticket, { requestedBy: "client" });
    ticket.updatedAt = nowIso();
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
      // A staff-authored ticket is inherently already staff-handled —
      // auto-claimed by its creator so Mastermind never auto-replies to
      // something a human just wrote themselves.
      humanRequested: true,
      humanRequestedAt: at,
      humanRequestedBy: "staff",
      claimedByUserId: req.userId,
      claimedByRole: req.isAdmin ? "admin" : "analyst",
      claimedAt: at,
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

  // Join an open (or already-humanRequested) conversation. First to accept
  // becomes the sole active handler — the actual enforcement of
  // single-claim, since two staff clicking "Join" at once must not both
  // succeed. Idempotent for the same person; 409 for anyone else once
  // claimed, so the UI can show "already being handled by X."
  app.post("/api/analyst/support-requests/:id/claim", requireAnalyst, async (req, res) => {
    const ticket = findRequest(req.params.id);
    if (!ticket || !canSeeTicket(req, ticket)) {
      return res.status(404).json({ error: "Support request not found." });
    }
    if (ticket.claimedByUserId && ticket.claimedByUserId !== req.userId) {
      return res.status(409).json({
        error: "This conversation has already been claimed.",
        claimedByUserId: ticket.claimedByUserId,
      });
    }
    if (ticket.claimedByUserId === req.userId) return res.json(ticket); // already the claimant — no-op

    const actor = findUser(req.userId);
    const at = nowIso();
    ticket.claimedByUserId = req.userId;
    ticket.claimedByRole = req.isAdmin ? "admin" : "analyst";
    ticket.claimedAt = at;
    if (!ticket.humanRequested) {
      ticket.humanRequested = true;
      ticket.humanRequestedAt = at;
      ticket.humanRequestedBy = "staff";
    }
    ticket.messages.push({
      id: randomUUID(), authorRole: "staff", authorId: req.userId,
      authorLabel: actor?.companyName || actor?.email || "ShieldAI support",
      body: `${actor?.companyName || actor?.email || "A team member"} joined the conversation.`,
      at,
    });
    ticket.updatedAt = at;
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

    // Replying to a client-facing ticket implicitly claims it, if nobody
    // has already — a human replying IS them joining; this stops Mastermind
    // from stepping on a reply that was sent without an explicit /claim first.
    if (ticket.clientUserId && !ticket.claimedByUserId) {
      ticket.claimedByUserId = req.userId;
      ticket.claimedByRole = req.isAdmin ? "admin" : "analyst";
      ticket.claimedAt = at;
      if (!ticket.humanRequested) {
        ticket.humanRequested = true;
        ticket.humanRequestedAt = at;
        ticket.humanRequestedBy = "staff";
      }
    }

    // pushNotification no-ops safely on a null userId (internal tickets),
    // but logClientAction has no such guard — db.data.clientActions is
    // keyed entirely by clientUserId, so only log it when there's a real
    // client, matching the create route's same clientUserId-gated pattern.
    if (ticket.clientUserId) {
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
    }
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
