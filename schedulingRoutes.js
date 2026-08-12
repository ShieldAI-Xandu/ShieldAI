// schedulingRoutes.js
// "Schedule a call" — Zoom or Google Meet, on demand, from the Support
// Center. Deliberately a SEPARATE connection/consent from directoryRoutes.js's
// Zoom/Google Workspace posture connections: those use an org-admin
// read-only scope to read security settings; this needs a PERSONAL user's
// calendar/meeting-create scope. Reusing the admin connection's consent
// grant for a write action would violate least-privilege — a different
// human (a regular user, not necessarily an account admin) may even be the
// one connecting this, and the token this issues can create meetings, not
// read directory posture.
//
// This is the first WRITE capability across every integration in this
// codebase. Scoped narrowly on purpose: a human explicitly requests one
// meeting via POST /api/scheduling/:id/create-meeting, ShieldAI creates
// exactly that one meeting, nothing else — no calendar reads, no meeting
// management, no recurring access beyond the single create call each time.
// Not a relaxation of the "AI advises, humans act" boundary — a bounded,
// human-initiated exception to it.
//
// Mount from server.js:
//   import { registerSchedulingRoutes } from "./schedulingRoutes.js";
//   registerSchedulingRoutes(app, { db, requireAuth, gate });

import { randomUUID } from "crypto";
import { counters } from "./tierGate.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { SCHEDULING_PROVIDERS } from "./schedulingAdapters.js";
import { createPendingGrant, consumePendingGrant } from "./oauthPendingGrants.js";

const nowIso = () => new Date().toISOString();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_LABELS = { zoom: "Zoom", google_meet: "Google Meet" };

function publicAppUrl() {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}
function redirectUriFor(provider) {
  return `${publicAppUrl()}/api/scheduling/oauth/${provider}/callback`;
}

// Reuses the same Zoom/Google OAuth apps directoryRoutes.js registers
// (MS_GRAPH_.../ZOOM_.../GOOGLE_WORKSPACE_... env vars aren't reused here —
// only ZOOM_CLIENT_ID/SECRET and GOOGLE_WORKSPACE_CLIENT_ID/SECRET are,
// since those two apps can also request this narrower scope). What matters
// for least-privilege is that the CONSENT and resulting TOKEN are separate
// and minimal, not that a distinct OAuth app was registered — this
// connection's token only ever carries meeting/calendar-create scope,
// never the directory-read scope, regardless of which app issued it.
const OAUTH_PROVIDERS = {
  zoom: {
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    scope: () => SCHEDULING_PROVIDERS.zoom.scopes.join(" "),
    clientId: () => process.env.ZOOM_CLIENT_ID,
    clientSecret: () => process.env.ZOOM_CLIENT_SECRET,
    extraAuthParams: {},
  },
  google_meet: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: () => [...SCHEDULING_PROVIDERS.google_meet.scopes, "openid", "email"].join(" "),
    clientId: () => process.env.GOOGLE_WORKSPACE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_WORKSPACE_CLIENT_SECRET,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
};

function ensureCollections(db) {
  db.data.schedulingConnections ||= [];
}

function publicConnection(c) {
  return {
    id: c.id, provider: c.provider, label: c.label, accountLabel: c.accountLabel || null,
    status: c.status, connectedAt: c.connectedAt, revokedAt: c.revokedAt || null,
  };
}

async function exchangeCode(provider, code) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUriFor(provider),
    client_id: cfg.clientId() || "", client_secret: cfg.clientSecret() || "",
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  return json;
}

async function refreshToken(provider, refreshTokenValue) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshTokenValue,
    client_id: cfg.clientId() || "", client_secret: cfg.clientSecret() || "",
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token refresh failed (${res.status})`);
  return json;
}

function decodeJwtPayload(token) {
  try {
    const seg = String(token).split(".")[1];
    return JSON.parse(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch { return {}; }
}

export function registerSchedulingRoutes(app, { db, requireAuth, gate }) {
  ensureCollections(db);

  const oauthStates = new Map();
  function sweepStates() {
    const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
    for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
  }
  function findMine(req, id) {
    return (db.data.schedulingConnections || []).find(c => c.id === id && c.ownerUserId === req.userId);
  }

  app.get("/api/scheduling", requireAuth, (req, res) => {
    const mine = (db.data.schedulingConnections || []).filter(c => c.ownerUserId === req.userId);
    res.json(mine.map(publicConnection));
  });

  app.get("/api/scheduling/oauth/:provider/start", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    (req, res) => {
      const provider = req.params.provider;
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return res.status(400).json({ error: "Unknown scheduling provider." });
      if (!cfg.clientId() || !cfg.clientSecret()) {
        return res.status(500).json({ error: `${PROVIDER_LABELS[provider]} isn't configured on this server yet.` });
      }
      sweepStates();
      const state = randomUUID();
      oauthStates.set(state, { userId: req.userId, createdAt: Date.now() });

      const url = new URL(cfg.authorizeUrl);
      url.searchParams.set("client_id", cfg.clientId());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUriFor(provider));
      url.searchParams.set("scope", cfg.scope());
      url.searchParams.set("state", state);
      for (const [k, v] of Object.entries(cfg.extraAuthParams || {})) url.searchParams.set(k, v);
      res.json({ url: url.toString() });
    });

  app.get("/api/scheduling/oauth/:provider/callback", async (req, res) => {
    const provider = req.params.provider;
    const appUrl = publicAppUrl();
    const fail = (reason) => res.redirect(`${appUrl}/?schedulingError=${encodeURIComponent(reason)}&provider=${provider}`);
    try {
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return fail("unknown_provider");
      const { code, state, error: providerError } = req.query;
      if (providerError) return fail(String(providerError).slice(0, 100));

      sweepStates();
      const stateEntry = state && oauthStates.get(String(state));
      if (!stateEntry) return fail("expired_or_invalid_state");
      oauthStates.delete(String(state));

      const tokens = await exchangeCode(provider, code);
      if (!tokens.refresh_token) return fail("no_refresh_token");

      let accountLabel = PROVIDER_LABELS[provider];
      if (provider === "google_meet" && tokens.id_token) {
        const claims = decodeJwtPayload(tokens.id_token);
        accountLabel = claims.email || accountLabel;
      } else if (provider === "zoom") {
        accountLabel = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${tokens.access_token}` } })
          .then(r => r.ok ? r.json() : null).then(u => u?.email || accountLabel).catch(() => accountLabel);
      }

      // NOT attributed to anyone yet — see oauthPendingGrants.js. Only an
      // authenticated call to /finish below does that. Especially important
      // here: this is the one WRITE-capable integration in the codebase —
      // without this, an attacker could end up able to create meetings on a
      // victim's own Zoom/Google Calendar account through ShieldAI.
      const pendingId = createPendingGrant("scheduling", {
        provider,
        accountLabel: String(accountLabel).slice(0, 200),
        refreshToken: tokens.refresh_token,
      });
      res.redirect(`${appUrl}/?schedulingOAuthPending=${pendingId}&provider=${provider}`);
    } catch (err) {
      console.error(`${provider} scheduling OAuth callback error:`, err.message);
      fail("connect_failed");
    }
  });

  // Finish step: the connection is attributed to whoever calls THIS
  // (authenticated) — never to whoever completed the browser redirect at
  // /callback above. See oauthPendingGrants.js's header for the
  // confused-deputy issue this closes.
  app.post("/api/scheduling/oauth/finish", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      const pendingId = String(req.body?.pendingId || "");
      if (!pendingId) return res.status(400).json({ error: "Missing pendingId." });
      const grant = consumePendingGrant("scheduling", pendingId);
      if (!grant) return res.status(410).json({ error: "This connection attempt has expired or already been used — try connecting again." });

      const connection = {
        id: randomUUID(),
        ownerUserId: req.userId,
        provider: grant.provider, kind: "oauth",
        label: PROVIDER_LABELS[grant.provider],
        accountLabel: grant.accountLabel,
        status: "active",
        encryptedSecret: encryptSecret(grant.refreshToken),
        connectedAt: nowIso(),
        connectedBy: req.userId,
        revokedAt: null,
      };
      db.data.schedulingConnections.push(connection);
      await db.write();
      res.json({ ok: true, id: connection.id, provider: connection.provider });
    });

  // The one write action this whole file exists for.
  app.post("/api/scheduling/:id/create-meeting", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    if (c.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    const { topic, startTime, durationMinutes } = req.body || {};
    if (!startTime || Number.isNaN(Date.parse(startTime))) {
      return res.status(400).json({ error: "A valid startTime is required." });
    }

    try {
      const refreshTokenValue = decryptSecret(c.encryptedSecret);
      let refreshed;
      try {
        refreshed = await refreshToken(c.provider, refreshTokenValue);
      } catch (err) {
        c.status = "error";
        await db.write();
        return res.status(409).json({ error: `${c.label} access has expired or was revoked — reconnect this integration.`, detail: err.message });
      }
      if (refreshed.refresh_token) c.encryptedSecret = encryptSecret(refreshed.refresh_token);

      const adapter = SCHEDULING_PROVIDERS[c.provider];
      const meeting = await adapter.create(refreshed.access_token, {
        topic: topic || "ShieldAI call", startTime, durationMinutes: durationMinutes || 30,
      });
      await db.write();
      res.json({ ok: true, meeting });
    } catch (err) {
      console.error("Create meeting error:", err.message);
      res.status(502).json({ error: `Could not create the meeting: ${err.message}` });
    }
  });

  app.post("/api/scheduling/:id/revoke", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    c.status = "revoked";
    c.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: c.id, status: c.status });
  });

  app.delete("/api/scheduling/:id", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    db.data.schedulingConnections = (db.data.schedulingConnections || []).filter(x => x.id !== c.id);
    await db.write();
    res.json({ ok: true, id: c.id });
  });

  console.log("ShieldAI scheduling routes registered.");
}
