// productivityRoutes.js
// Productivity-tool connections: Slack in this pass (OAuth app install,
// channel picking, notification delivery, and two-way interactive actions).
// See INTEGRATIONS_SETUP.md for the Teams/Jira/Asana/Trello/Zoom/Meet
// roadmap this was scoped alongside.
//
// BOUNDARY: outbound (notify()) only ever POSTS a message ShieldAI wrote —
// it never reads a client's Slack history or anything else in their
// workspace beyond the channel list needed to let them pick where to post.
// Inbound (the interactivity endpoint) only ever triggers an action a human
// clicked a button for, and that action routes through the SAME handlers
// the in-app buttons already use — there's no separate, parallel "what a
// Slack button can do" capability surface.
//
// Mount from server.js:
//   import { registerProductivityRoutes } from "./productivityRoutes.js";
//   registerProductivityRoutes(app, { db, requireAuth, gate, logClientAction, express });
// The Slack interactivity route needs the RAW body for signature
// verification. Two things make that work, mirroring billingRoutes.js's
// existing Stripe-webhook precedent exactly: server.js carves this one path
// out of the global JSON parser, AND this file mounts express.raw() as
// route-level middleware on just that path (Slack's interactivity payload
// is form-encoded, not JSON, so the type here differs from billingRoutes.js's).
// `express` is injected rather than imported directly, same convention
// billingRoutes.js already uses.

import { randomUUID } from "crypto";
import { counters } from "./tierGate.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { fetchSlackChannels, respondToSlack } from "./productivityAdapters.js";
import { verifySlackSignature } from "./webhookSignature.js";
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_IDS } from "./notificationDispatch.js";

const nowIso = () => new Date().toISOString();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function publicAppUrl() {
  // Same APP_URL convention billingRoutes.js/phishingRoutes.js/
  // policyAcknowledgmentRoutes.js/directoryRoutes.js already use.
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}
function redirectUriFor() {
  return `${publicAppUrl()}/api/productivity/oauth/slack/callback`;
}

function ensureCollections(db) {
  db.data.productivityConnections ||= [];
}

function publicConnection(c) {
  return {
    id: c.id, provider: c.provider, label: c.label, teamOrWorkspace: c.teamOrWorkspace,
    status: c.status, channelId: c.channelId || null, channelName: c.channelName || null,
    enabledEvents: c.enabledEvents || [], connectedAt: c.connectedAt,
    lastNotifiedAt: c.lastNotifiedAt || null, revokedAt: c.revokedAt || null,
  };
}

// Recommendation status constants/shape mirrored from agentRoutes.js (not
// imported — that file's pushHistory/REC_STATUSES are private closures, and
// the established convention in this codebase, per integrationRoutes.js and
// directoryRoutes.js already mirroring agentRoutes.js's draft-building
// rather than importing it, is each ingestion/action source carries its own
// copy of the shape it writes). Only the three actions the Slack buttons
// offer are handled here — "handle"/"complete"/"decline" map exactly onto
// the client's existing decision+complete recommendation actions
// (agentRoutes.js's /api/admin/recommendations/:id/decision and
// /api/recommendations/:id/complete). Task completion has real scoring
// side effects (re-answers the assessment checklist, recomputes posture) —
// too risky to duplicate inline, so it's never offered as a Slack action;
// task.completed is an outbound-only notification.
const SLACK_ACTION_STATUS = { handle: "client_performing", complete: "completed", decline: "declined" };

function pushRecHistory(rec, actorType, actorId, status, note) {
  rec.history = rec.history || [];
  rec.history.push({ at: nowIso(), actorType, actorId: actorId || null, status, note: note || "" });
  rec.status = status;
}

export function registerProductivityRoutes(app, { db, requireAuth, gate, logClientAction, express }) {
  ensureCollections(db);

  // state -> { userId, createdAt } — short-lived CSRF binding for the OAuth
  // round-trip, same in-memory pattern directoryRoutes.js already uses (not
  // user data, so a restart just invalidates an in-flight connect attempt).
  const oauthStates = new Map();
  function sweepStates() {
    const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
    for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES
  // ════════════════════════════════════════════════════════════

  app.get("/api/productivity", requireAuth, (req, res) => {
    const mine = (db.data.productivityConnections || []).filter(c => c.ownerUserId === req.userId);
    res.json(mine.map(publicConnection));
  });

  app.get("/api/productivity/:id", requireAuth, (req, res) => {
    const c = (db.data.productivityConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    res.json({ connection: publicConnection(c), availableEvents: NOTIFICATION_EVENTS });
  });

  // Set which channel to post to and which events should notify it.
  app.patch("/api/productivity/:id", requireAuth, async (req, res) => {
    const c = (db.data.productivityConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    if (c.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    if (req.body?.channelId !== undefined) {
      c.channelId = String(req.body.channelId).slice(0, 64) || null;
      c.channelName = req.body.channelName ? String(req.body.channelName).slice(0, 200) : null;
    }
    if (Array.isArray(req.body?.enabledEvents)) {
      c.enabledEvents = req.body.enabledEvents.filter(e => NOTIFICATION_EVENT_IDS.includes(e));
    }
    await db.write();
    res.json({ ok: true, connection: publicConnection(c) });
  });

  // Channels the bot has been invited to, for the channel picker.
  app.get("/api/productivity/:id/channels", requireAuth, async (req, res) => {
    const c = (db.data.productivityConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    try {
      const accessToken = decryptSecret(c.encryptedSecret);
      const channels = await fetchSlackChannels({ accessToken });
      res.json(channels);
    } catch (err) {
      console.error("Slack channel list error:", err.message);
      res.status(502).json({ error: "Could not list Slack channels — check the connection is still authorized." });
    }
  });

  // ── Slack: OAuth app-install flow ───────────────────────────────
  // Returns the authorize URL as JSON rather than redirecting directly —
  // requireAuth only recognizes a Bearer header (no cookie session), which
  // a plain browser navigation can't carry. Same pattern as
  // directoryRoutes.js's OAuth start route.
  app.get("/api/productivity/oauth/slack/start", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    (req, res) => {
      const clientId = process.env.SLACK_CLIENT_ID;
      if (!clientId || !process.env.SLACK_CLIENT_SECRET) {
        return res.status(500).json({ error: "Slack isn't configured on this server yet." });
      }
      sweepStates();
      const state = randomUUID();
      oauthStates.set(state, { userId: req.userId, createdAt: Date.now() });

      const url = new URL("https://slack.com/oauth/v2/authorize");
      url.searchParams.set("client_id", clientId);
      // Bot scopes only — chat:write to post, channels:read/groups:read so
      // the channel picker can list where the bot's been invited.
      url.searchParams.set("scope", "chat:write,channels:read,groups:read");
      url.searchParams.set("redirect_uri", redirectUriFor());
      url.searchParams.set("state", state);
      res.json({ url: url.toString() });
    });

  app.get("/api/productivity/oauth/slack/callback", async (req, res) => {
    const appUrl = publicAppUrl();
    const fail = (reason) => res.redirect(`${appUrl}/?productivityError=${encodeURIComponent(reason)}&provider=slack`);
    try {
      const { code, state, error: providerError } = req.query;
      if (providerError) return fail(String(providerError).slice(0, 100));

      sweepStates();
      const stateEntry = state && oauthStates.get(String(state));
      if (!stateEntry) return fail("expired_or_invalid_state");
      oauthStates.delete(String(state));

      const body = new URLSearchParams({
        code, client_id: process.env.SLACK_CLIENT_ID || "", client_secret: process.env.SLACK_CLIENT_SECRET || "",
        redirect_uri: redirectUriFor(),
      });
      const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      const tokens = await tokenRes.json();
      if (!tokens.ok || !tokens.access_token) {
        console.error("Slack OAuth exchange failed:", tokens.error);
        return fail("connect_failed");
      }

      const connection = {
        id: randomUUID(),
        ownerUserId: stateEntry.userId,
        provider: "slack",
        kind: "oauth_bot",
        label: "Slack",
        teamOrWorkspace: tokens.team?.name || "Slack workspace",
        status: "active",
        encryptedSecret: encryptSecret(tokens.access_token), // xoxb- bot token; doesn't expire the way an OAuth refresh token does, still encrypted at rest
        externalTeamId: tokens.team?.id || null, // resolves an inbound Slack interactivity payload back to this connection/owner without trusting client-supplied data
        channelId: null,
        channelName: null,
        enabledEvents: [],
        connectedAt: nowIso(),
        connectedBy: stateEntry.userId,
        lastNotifiedAt: null,
        revokedAt: null,
      };
      db.data.productivityConnections.push(connection);
      await db.write();

      res.redirect(`${appUrl}/?productivityConnected=1&provider=slack&id=${connection.id}`);
    } catch (err) {
      console.error("Slack OAuth callback error:", err.message);
      fail("connect_failed");
    }
  });

  app.post("/api/productivity/:id/revoke", requireAuth, async (req, res) => {
    const c = (db.data.productivityConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    c.status = "revoked";
    c.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: c.id, status: c.status });
  });

  app.delete("/api/productivity/:id", requireAuth, async (req, res) => {
    const c = (db.data.productivityConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    db.data.productivityConnections = (db.data.productivityConnections || []).filter(x => x.id !== c.id);
    await db.write();
    res.json({ ok: true, id: c.id });
  });

  // ════════════════════════════════════════════════════════════
  //  SLACK-FACING ROUTE — no human session; Slack calls this directly.
  //  Mounted with express.raw() in server.js so the exact signed bytes are
  //  available for signature verification before any parsing happens.
  // ════════════════════════════════════════════════════════════
  app.post("/api/productivity/slack/interactivity", express.raw({ type: "application/x-www-form-urlencoded" }), async (req, res) => {
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    const rawBody = req.body; // Buffer, thanks to the express.raw() middleware just above
    const valid = verifySlackSignature({
      rawBody: rawBody?.toString("utf8"),
      timestampHeader: req.headers["x-slack-request-timestamp"],
      signatureHeader: req.headers["x-slack-signature"],
      signingSecret,
    });
    if (!valid) return res.status(401).send("Invalid signature.");

    let payload;
    try {
      const form = new URLSearchParams(rawBody.toString("utf8"));
      payload = JSON.parse(form.get("payload") || "{}");
    } catch {
      return res.status(400).send("Malformed payload.");
    }

    const action = payload.actions?.[0];
    if (!action?.value) return res.status(200).send(""); // nothing actionable — ack anyway, Slack retries on non-2xx

    let decoded;
    try { decoded = JSON.parse(action.value); } catch { return res.status(200).send(""); }

    const slackUser = payload.user?.username || payload.user?.id || "someone";
    try {
      // Tenant isolation: resolve which ShieldAI account this click belongs
      // to from the Slack TEAM id on an active connection row — never from
      // anything inside the (attacker-shaped-if-signature-weren't-checked)
      // button value alone. Signature verification proves Slack sent this
      // request; it does NOT prove which workspace's data the target
      // recommendation belongs to.
      const teamId = payload.team?.id;
      const conn = (db.data.productivityConnections || []).find(c =>
        c.provider === "slack" && c.status === "active" && c.externalTeamId === teamId
      );
      if (!conn) throw new Error("No active Slack connection for this workspace.");

      if (decoded.refType !== "recommendation") throw new Error("Unsupported action target.");
      const rec = (db.data.recommendations || []).find(r => r.id === decoded.refId);
      // Same isolation check the HTTP recommendation routes make
      // (rec.ownerUserId === req.userId) — here req.userId is whatever the
      // matched Slack connection's ownerUserId is.
      if (!rec || rec.ownerUserId !== conn.ownerUserId) throw new Error("Recommendation not found for this workspace.");

      const status = SLACK_ACTION_STATUS[decoded.action];
      if (!status) throw new Error("Unsupported action.");
      if (status === "completed" && rec.status !== "permitted" && rec.status !== "client_performing" && rec.status !== "proposed" && rec.status !== "suggested") {
        throw new Error("This recommendation can't be completed from its current state.");
      }

      pushRecHistory(rec, "slack", slackUser, status, `Via Slack (${slackUser}).`);
      if (logClientAction) logClientAction(db, {
        clientUserId: rec.ownerUserId, actorUserId: null, actorRole: "slack",
        action: `recommendation_${decoded.action}`, recommendationId: rec.id,
        detail: `Applied via Slack by ${slackUser}.`,
      });
      await db.write();

      await respondToSlack({
        responseUrl: payload.response_url,
        text: `✅ Done — recommendation marked *${status}* via Slack (${slackUser}).`,
      });
    } catch (err) {
      console.warn("Slack interactivity action not applied:", err.message);
      await respondToSlack({ responseUrl: payload.response_url, text: `⚠️ Couldn't apply that action (${err.message}). Check ShieldAI directly.` });
    }

    res.status(200).send("");
  });

  console.log("ShieldAI productivity integration routes registered.");
}
