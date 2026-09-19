// staffChatRoutes.js
// Internal admin/analyst chat: one fixed "Team" group channel everyone on
// staff is automatically in, plus 1:1 DMs between any two staff members.
//
// Deliberately minimal: one flat collection, no separate channel-metadata
// table. A channel id is either the fixed string "team", or a deterministic
// `dm:<idA>:<idB>` (ids sorted) for a DM — so a DM thread needs no creation
// step at all, it's just derived from the two participants and exists the
// moment the first message is posted.
//
// Polling, not push — mirrors portfolioRoutes.js's clientMessages exactly
// (20s poll on the frontend); this app has no WebSocket/SSE infrastructure
// anywhere and every other "live" feature already works this way.
//
// Mount from server.js:
//   import { registerStaffChatRoutes } from "./staffChatRoutes.js";
//   registerStaffChatRoutes(app, { db, requireAuth });

import { randomUUID } from "crypto";
import { pushNotification } from "./portfolioRoutes.js";

const nowIso = () => new Date().toISOString();
const TEAM_CHANNEL = "team";

function dmChannelId(idA, idB) {
  return `dm:${[idA, idB].sort().join(":")}`;
}

export function registerStaffChatRoutes(app, { db, requireAuth }) {
  // { id, channelId, authorId, authorLabel, authorRole: "admin"|"analyst", body, at }
  //
  // messages() (not a bare db.data.staffChatMessages reference) self-heals
  // per store on first access — bootstrapping the array once here, at
  // registration time, only ever touches whatever store is ambient at
  // server boot (production), never demo-db.json's template or a
  // per-visitor demo sandbox cloned from it. See the identical fix + longer
  // explanation in supportRoutes.js's requests() accessor, which this
  // mirrors.
  const messages = () => (db.data.staffChatMessages ||= []);

  const users = () => db.data.users || [];
  const findUser = id => users().find(u => u.id === id) || null;
  const isStaff = u => !!u && (u.isAdmin || u.isAnalyst);

  function requireStaff(req, res, next) {
    requireAuth(req, res, () => {
      const u = findUser(req.userId);
      if (!isStaff(u)) return res.status(403).json({ error: "Staff access required." });
      req.isAdmin = !!u.isAdmin;
      next();
    });
  }

  function label(u) {
    return u?.companyName || u?.email || "Staff";
  }

  const sortByAtAsc = (a, b) => new Date(a.at) - new Date(b.at);

  // ── Team (group) channel — everyone on staff, no membership to manage ──
  app.get("/api/staff/chat/team/messages", requireStaff, (req, res) => {
    const list = messages()
      .filter(m => m.channelId === TEAM_CHANNEL)
      .sort(sortByAtAsc)
      .slice(-200);
    res.json(list);
  });

  app.post("/api/staff/chat/team/messages", requireStaff, async (req, res) => {
    const body = (req.body?.message || "").trim();
    if (!body) return res.status(400).json({ error: "message is required." });
    if (body.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const actor = findUser(req.userId);
    const message = {
      id: randomUUID(),
      channelId: TEAM_CHANNEL,
      authorId: req.userId,
      authorLabel: label(actor),
      authorRole: req.isAdmin ? "admin" : "analyst",
      body,
      at: nowIso(),
    };
    messages().push(message);
    // Deliberately no per-message notification here — pinging every
    // admin/analyst on every group-channel message would be noisy; the
    // Chats page's own poll surfaces new messages while it's open, same as
    // DMs surface via the page itself when the recipient has it open.
    await db.write();
    res.json(message);
  });

  // ── Direct messages — deterministic channel id, no create step ──
  app.get("/api/staff/chat/dm/:userId/messages", requireStaff, (req, res) => {
    const other = findUser(req.params.userId);
    if (!isStaff(other)) return res.status(404).json({ error: "Staff member not found." });
    const channelId = dmChannelId(req.userId, other.id);
    const list = messages()
      .filter(m => m.channelId === channelId)
      .sort(sortByAtAsc)
      .slice(-200);
    res.json(list);
  });

  app.post("/api/staff/chat/dm/:userId/messages", requireStaff, async (req, res) => {
    const other = findUser(req.params.userId);
    if (!isStaff(other)) return res.status(404).json({ error: "Staff member not found." });
    if (other.id === req.userId) return res.status(400).json({ error: "Can't DM yourself." });
    const body = (req.body?.message || "").trim();
    if (!body) return res.status(400).json({ error: "message is required." });
    if (body.length > 2000) return res.status(400).json({ error: "message is too long (2000 char max)." });

    const actor = findUser(req.userId);
    const message = {
      id: randomUUID(),
      channelId: dmChannelId(req.userId, other.id),
      authorId: req.userId,
      authorLabel: label(actor),
      authorRole: req.isAdmin ? "admin" : "analyst",
      body,
      at: nowIso(),
    };
    messages().push(message);
    pushNotification(db, {
      userId: other.id,
      type: "staff_dm",
      title: `New message from ${label(actor)}`,
      body: body.slice(0, 900),
      actorRole: req.isAdmin ? "admin" : "analyst",
    });
    await db.write();
    res.json(message);
  });

  // Sidebar data: who you've already DM'd (derived from message history,
  // no separate index needed at this scale) plus the full staff roster so
  // the UI can offer "start a new DM" with someone you haven't messaged yet.
  app.get("/api/staff/chat/dm-threads", requireStaff, (req, res) => {
    // Single pass building channelId -> latest `at` (messages are appended
    // in order, so the last one seen per channel is the latest) instead of
    // re-filtering the whole message history once per thread found.
    const mine = new Set();
    const lastAtByChannel = new Map();
    for (const m of messages()) {
      if (!m.channelId.startsWith("dm:")) continue;
      lastAtByChannel.set(m.channelId, m.at);
      const [, a, b] = m.channelId.split(":");
      if (a === req.userId) mine.add(b);
      else if (b === req.userId) mine.add(a);
    }
    const threads = [...mine].map(id => {
      const u = findUser(id);
      if (!u) return null;
      return { userId: u.id, name: label(u), lastMessageAt: lastAtByChannel.get(dmChannelId(req.userId, id)) || null };
    }).filter(Boolean).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    const roster = users()
      .filter(u => isStaff(u) && u.id !== req.userId)
      .map(u => ({ userId: u.id, name: label(u) }));

    res.json({ threads, roster });
  });
}
