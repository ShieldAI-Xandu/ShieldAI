// taskTrackerRoutes.js
// Task-tracker connections: Jira (Atlassian OAuth 2.0 / 3LO), Asana (OAuth2),
// Trello (paste-in API key + token, same model as Okta's directory
// connection). Lets a client sync a ShieldAI remediation task to an
// external ticket and pull its status back on demand.
//
// BOUNDARY: creating a ticket is the only write this file ever performs on
// a connected tracker. Pulling status is read-only and purely informational
// — it never drives a ShieldAI task through the real completion flow
// (taskRoutes.js's /complete, which has posture-scoring side effects). A
// human still clicks "Mark done" in ShieldAI itself to actually complete a
// task, exactly like the productivity-notification buttons never
// auto-complete one either. No inbound webhooks (see
// taskTrackerAdapters.js's header for why) — status changes are pulled on
// demand via a "Sync status" action, mirroring directoryRoutes.js's
// proven "Sync now" pattern.
//
// Mount from server.js:
//   import { registerTaskTrackerRoutes } from "./taskTrackerRoutes.js";
//   registerTaskTrackerRoutes(app, { db, requireAuth, gate, logClientAction });

import { randomUUID } from "crypto";
import { counters } from "./tierGate.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { setTaskExternalRef } from "./taskRoutes.js";
import { createPendingGrant, consumePendingGrant } from "./oauthPendingGrants.js";
import {
  JIRA_SCOPES, resolveJiraSites, fetchJiraProjects, createJiraIssue, fetchJiraStatus,
  fetchAsanaWorkspaces, fetchAsanaProjects, createAsanaTask, fetchAsanaStatus,
  fetchTrelloBoards, fetchTrelloLists, createTrelloCard, fetchTrelloCard, validateTrelloCredential,
} from "./taskTrackerAdapters.js";

const nowIso = () => new Date().toISOString();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function publicAppUrl() {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}
function redirectUriFor(provider) {
  return `${publicAppUrl()}/api/tasktracker/oauth/${provider}/callback`;
}

const PROVIDER_LABELS = { jira: "Jira", asana: "Asana" };

const OAUTH_PROVIDERS = {
  jira: {
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scope: () => [...JIRA_SCOPES, "offline_access"].join(" "),
    clientId: () => process.env.JIRA_CLIENT_ID,
    clientSecret: () => process.env.JIRA_CLIENT_SECRET,
    extraAuthParams: { audience: "api.atlassian.com", prompt: "consent" },
    extraTokenParams: { audience: "api.atlassian.com" },
  },
  asana: {
    authorizeUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token",
    scope: () => "default",
    clientId: () => process.env.ASANA_CLIENT_ID,
    clientSecret: () => process.env.ASANA_CLIENT_SECRET,
    extraAuthParams: {},
    extraTokenParams: {},
  },
};

function ensureCollections(db) {
  db.data.taskTrackerConnections ||= [];
}

function publicConnection(c) {
  return {
    id: c.id, provider: c.provider, kind: c.kind, label: c.label,
    siteOrWorkspace: c.siteOrWorkspace || null, status: c.status,
    // Provider-specific picker selections, exposed generically so the
    // frontend can tell what's still unset without a provider switch.
    projectKey: c.projectKey || null, projectName: c.projectName || null,
    workspaceGid: c.workspaceGid || null, projectGid: c.projectGid || null,
    boardId: c.boardId || null, boardName: c.boardName || null,
    defaultListId: c.defaultListId || null, defaultListName: c.defaultListName || null,
    doneListId: c.doneListId || null, doneListName: c.doneListName || null,
    connectedAt: c.connectedAt, revokedAt: c.revokedAt || null,
  };
}

async function exchangeOAuthCode(provider, code) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUriFor(provider),
    client_id: cfg.clientId() || "", client_secret: cfg.clientSecret() || "",
    ...cfg.extraTokenParams,
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  return json;
}

async function refreshOAuthToken(provider, refreshToken) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken,
    client_id: cfg.clientId() || "", client_secret: cfg.clientSecret() || "",
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token refresh failed (${res.status})`);
  return json;
}

// A connection's credential, freshly usable for one call. OAuth providers
// refresh (and, if the provider returns a new refresh_token, re-store it);
// Trello's paste-in token doesn't expire, so it's used as-is.
async function liveCredential(db, connection) {
  if (connection.kind === "oauth") {
    const refreshToken = decryptSecret(connection.encryptedSecret);
    let refreshed;
    try {
      refreshed = await refreshOAuthToken(connection.provider, refreshToken);
    } catch (err) {
      // Mirrors directoryRoutes.js's sync handler: a dead refresh token means
      // this connection needs reconnecting, not just "this one call failed."
      connection.status = "error";
      await db.write();
      throw err;
    }
    if (refreshed.refresh_token) connection.encryptedSecret = encryptSecret(refreshed.refresh_token);
    return { accessToken: refreshed.access_token };
  }
  const raw = decryptSecret(connection.encryptedSecret);
  return JSON.parse(raw); // Trello: { apiKey, token }
}

export function registerTaskTrackerRoutes(app, { db, requireAuth, gate, logClientAction }) {
  ensureCollections(db);

  const oauthStates = new Map();
  function sweepStates() {
    const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
    for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
  }

  function findMine(req, id) {
    return (db.data.taskTrackerConnections || []).find(c => c.id === id && c.ownerUserId === req.userId);
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES
  // ════════════════════════════════════════════════════════════

  app.get("/api/tasktracker", requireAuth, (req, res) => {
    const mine = (db.data.taskTrackerConnections || []).filter(c => c.ownerUserId === req.userId);
    res.json(mine.map(publicConnection));
  });

  app.get("/api/tasktracker/:id", requireAuth, (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    res.json(publicConnection(c));
  });

  // ── OAuth start/callback (Jira, Asana) ──────────────────────────
  app.get("/api/tasktracker/oauth/:provider/start", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    (req, res) => {
      const provider = req.params.provider;
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return res.status(400).json({ error: "Unknown task tracker provider." });
      if (!cfg.clientId() || !cfg.clientSecret()) {
        return res.status(500).json({ error: `${PROVIDER_LABELS[provider] || provider} isn't configured on this server yet.` });
      }
      sweepStates();
      const state = randomUUID();
      oauthStates.set(state, { userId: req.userId, provider, createdAt: Date.now() });

      const url = new URL(cfg.authorizeUrl);
      url.searchParams.set("client_id", cfg.clientId());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", redirectUriFor(provider));
      url.searchParams.set("scope", cfg.scope());
      url.searchParams.set("state", state);
      for (const [k, v] of Object.entries(cfg.extraAuthParams || {})) url.searchParams.set(k, v);
      res.json({ url: url.toString() });
    });

  app.get("/api/tasktracker/oauth/:provider/callback", async (req, res) => {
    const provider = req.params.provider;
    const appUrl = publicAppUrl();
    const fail = (reason) => res.redirect(`${appUrl}/?tasktrackerError=${encodeURIComponent(reason)}&provider=${provider}`);
    try {
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return fail("unknown_provider");
      const { code, state, error: providerError } = req.query;
      if (providerError) return fail(String(providerError).slice(0, 100));

      sweepStates();
      const stateEntry = state && oauthStates.get(String(state));
      if (!stateEntry) return fail("expired_or_invalid_state");
      oauthStates.delete(String(state));

      const tokens = await exchangeOAuthCode(provider, code);
      if (!tokens.refresh_token) return fail("no_refresh_token");

      let siteOrWorkspace = provider === "jira" ? "Jira" : "Asana";
      let extra = {};
      if (provider === "jira") {
        // Multiple accessible sites are possible if the authorizing account
        // belongs to more than one Jira Cloud site — v1 simplification:
        // use the first one. Reconnecting with a different account/site is
        // the workaround if that's ever wrong for a given client.
        try {
          const sites = await resolveJiraSites(tokens.access_token);
          // `name` (a friendly display name, may contain spaces/differ from
          // the subdomain) is for the UI label; `url` is the real
          // https://<subdomain>.atlassian.net site and is what a working
          // ticket link has to be built from — conflating the two here
          // previously produced browse links pointed at an invalid host
          // whenever a site's display name differed from its subdomain.
          if (sites[0]) { extra.cloudId = sites[0].id; extra.siteUrl = sites[0].url; siteOrWorkspace = sites[0].name || sites[0].url; }
        } catch { /* connection still saved; picker step will surface the problem */ }
      }

      // NOT attributed to anyone yet — see oauthPendingGrants.js. Only an
      // authenticated call to /finish below does that.
      const pendingId = createPendingGrant("tasktracker", {
        provider, siteOrWorkspace, refreshToken: tokens.refresh_token, extra,
      });
      res.redirect(`${appUrl}/?tasktrackerOAuthPending=${pendingId}&provider=${provider}`);
    } catch (err) {
      console.error(`${provider} OAuth callback error:`, err.message);
      fail("connect_failed");
    }
  });

  // Finish step: the connection is attributed to whoever calls THIS
  // (authenticated) — never to whoever completed the browser redirect at
  // /callback above. See oauthPendingGrants.js's header for the
  // confused-deputy issue this closes.
  app.post("/api/tasktracker/oauth/finish", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      try {
        const pendingId = String(req.body?.pendingId || "");
        if (!pendingId) return res.status(400).json({ error: "Missing pendingId." });
        const grant = consumePendingGrant("tasktracker", pendingId);
        if (!grant) return res.status(410).json({ error: "This connection attempt has expired or already been used — try connecting again." });

        const connection = {
          id: randomUUID(),
          ownerUserId: req.userId,
          provider: grant.provider, kind: "oauth",
          label: grant.siteOrWorkspace,
          siteOrWorkspace: grant.siteOrWorkspace,
          status: "active",
          encryptedSecret: encryptSecret(grant.refreshToken),
          connectedAt: nowIso(),
          connectedBy: req.userId,
          revokedAt: null,
          ...grant.extra,
        };
        db.data.taskTrackerConnections.push(connection);
        await db.write();
        res.json({ ok: true, id: connection.id, provider: connection.provider });
      } catch (err) {
        // See directoryRoutes.js's identical comment — encryptSecret() can
        // throw synchronously (missing/malformed CREDENTIAL_ENCRYPTION_KEY),
        // which unguarded here would crash the whole server via
        // server.js's unhandledRejection -> process.exit(1) handler.
        console.error("Task tracker OAuth finish error:", err.message);
        res.status(500).json({ error: "Could not complete this connection. Try again, or contact support if this keeps happening." });
      }
    });

  // ── Trello: paste-in API key + token ─────────────────────────────
  app.post("/api/tasktracker/connect/trello", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      try {
        const label = String(req.body?.label || "Trello").slice(0, 200).trim();
        const apiKey = String(req.body?.apiKey || "").trim();
        const token = String(req.body?.token || "").trim();
        if (!apiKey || !token) return res.status(400).json({ error: "API key and token are required." });

        const valid = await validateTrelloCredential({ apiKey, token });
        if (!valid) return res.status(400).json({ error: "Could not validate that Trello API key/token." });

        const connection = {
          id: randomUUID(),
          ownerUserId: req.userId,
          provider: "trello", kind: "token",
          label, siteOrWorkspace: "Trello",
          status: "active",
          encryptedSecret: encryptSecret(JSON.stringify({ apiKey, token })),
          connectedAt: nowIso(),
          connectedBy: req.userId,
          revokedAt: null,
        };
        db.data.taskTrackerConnections.push(connection);
        await db.write();
        res.json({ ok: true, id: connection.id });
      } catch (err) {
        console.error("Trello connect error:", err.message);
        res.status(500).json({ error: "Could not connect to Trello." });
      }
    });

  // ── Picker: whatever the next setup step needs ───────────────────
  // Jira: always projects (site already resolved at connect time). Asana:
  // workspaces first, then projects once ?workspaceGid= is given. Trello:
  // boards first, then lists once ?boardId= is given. One generic route
  // instead of six provider-specific ones.
  app.get("/api/tasktracker/:id/picker", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    try {
      const cred = await liveCredential(db, c);
      await db.write(); // liveCredential may have refreshed+re-stored the OAuth secret
      if (c.provider === "jira") {
        if (!c.cloudId) return res.status(409).json({ error: "Could not resolve a Jira site for this connection — reconnect it." });
        const projects = await fetchJiraProjects(cred.accessToken, c.cloudId);
        return res.json({ step: "project", options: projects });
      }
      if (c.provider === "asana") {
        const workspaceGid = req.query.workspaceGid || c.workspaceGid;
        if (!workspaceGid) {
          const workspaces = await fetchAsanaWorkspaces(cred.accessToken);
          return res.json({ step: "workspace", options: workspaces });
        }
        const projects = await fetchAsanaProjects(cred.accessToken, workspaceGid);
        return res.json({ step: "project", workspaceGid, options: projects });
      }
      if (c.provider === "trello") {
        const boardId = req.query.boardId || c.boardId;
        if (!boardId) {
          const boards = await fetchTrelloBoards(cred);
          return res.json({ step: "board", options: boards });
        }
        const lists = await fetchTrelloLists(cred, boardId);
        return res.json({ step: "list", boardId, options: lists });
      }
      res.status(400).json({ error: "Unknown provider." });
    } catch (err) {
      console.error("Task tracker picker error:", err.message);
      res.status(502).json({ error: "Could not load options — check the connection is still authorized." });
    }
  });

  // Save whichever picker selections apply to this provider.
  app.patch("/api/tasktracker/:id", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    if (c.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    const b = req.body || {};
    if (c.provider === "jira" && b.projectKey) { c.projectKey = String(b.projectKey).slice(0, 64); c.projectName = b.projectName ? String(b.projectName).slice(0, 200) : null; }
    if (c.provider === "asana") {
      if (b.workspaceGid) c.workspaceGid = String(b.workspaceGid).slice(0, 64);
      if (b.projectGid) { c.projectGid = String(b.projectGid).slice(0, 64); c.projectName = b.projectName ? String(b.projectName).slice(0, 200) : null; }
    }
    if (c.provider === "trello") {
      if (b.boardId) { c.boardId = String(b.boardId).slice(0, 64); c.boardName = b.boardName ? String(b.boardName).slice(0, 200) : null; }
      if (b.defaultListId) { c.defaultListId = String(b.defaultListId).slice(0, 64); c.defaultListName = b.defaultListName ? String(b.defaultListName).slice(0, 200) : null; }
      if (b.doneListId) { c.doneListId = String(b.doneListId).slice(0, 64); c.doneListName = b.doneListName ? String(b.doneListName).slice(0, 200) : null; }
    }
    await db.write();
    res.json({ ok: true, connection: publicConnection(c) });
  });

  // ── Sync a task: create once, then pull status on demand ─────────
  app.post("/api/tasktracker/:id/sync-task/:taskId", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    if (c.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    const task = (db.data.tasks || []).find(t => t.id === req.params.taskId && t.ownerUserId === req.userId);
    if (!task) return res.status(404).json({ error: "Task not found." });

    try {
      const cred = await liveCredential(db, c);
      let ref;
      // connectionId is checked when present so a task re-synced after
      // reconnecting to a DIFFERENT site/workspace/board (same provider,
      // different connection) creates a fresh ticket there instead of
      // pulling status from the old connection's issue key under the new
      // connection's credentials. Falls back to provider-only matching for
      // refs written before this field existed.
      if (task.externalRef?.provider === c.provider && task.externalRef?.externalId &&
          (!task.externalRef.connectionId || task.externalRef.connectionId === c.id)) {
        // Already synced to this connection — pull status instead of creating a duplicate.
        ref = await pullStatus(c, cred, task.externalRef);
      } else if (c.provider === "jira") {
        if (!c.projectKey) return res.status(409).json({ error: "Pick a Jira project for this connection first." });
        const created = await createJiraIssue(cred.accessToken, c.cloudId, { projectKey: c.projectKey, summary: task.title, description: task.detail });
        ref = { provider: "jira", connectionId: c.id, externalId: created.externalId, externalUrl: `${c.siteUrl}/browse/${created.externalId}`, externalStatus: "open", externalPriority: null, syncedAt: nowIso() };
      } else if (c.provider === "asana") {
        if (!c.projectGid) return res.status(409).json({ error: "Pick an Asana project for this connection first." });
        const created = await createAsanaTask(cred.accessToken, { workspaceGid: c.workspaceGid, projectGid: c.projectGid, name: task.title, notes: task.detail });
        ref = { provider: "asana", connectionId: c.id, externalId: created.externalId, externalUrl: created.externalUrl, externalStatus: "open", externalPriority: null, syncedAt: nowIso() };
      } else if (c.provider === "trello") {
        if (!c.defaultListId) return res.status(409).json({ error: "Pick a default list for this connection first." });
        const created = await createTrelloCard(cred, { listId: c.defaultListId, name: task.title, desc: task.detail });
        ref = { provider: "trello", connectionId: c.id, externalId: created.externalId, externalUrl: created.externalUrl, externalStatus: "open", externalPriority: null, syncedAt: nowIso() };
      } else {
        return res.status(400).json({ error: "Unknown provider." });
      }
      setTaskExternalRef(db, task.id, ref);
      await db.write();
      if (logClientAction) logClientAction(db, {
        clientUserId: task.ownerUserId, actorUserId: req.userId, actorRole: "client_admin",
        action: "task_synced_to_tracker", detail: `"${task.title}" synced to ${c.provider} (${ref.externalId}).`,
      });
      res.json({ ok: true, externalRef: ref });
    } catch (err) {
      console.error("Task tracker sync error:", err.message);
      res.status(502).json({ error: `Could not sync with ${c.provider}: ${err.message}` });
    }
  });

  async function pullStatus(connection, cred, existingRef) {
    if (connection.provider === "jira") {
      const s = await fetchJiraStatus(cred.accessToken, connection.cloudId, existingRef.externalId);
      return { ...existingRef, externalStatus: s.status, externalStatusLabel: s.statusLabel, externalPriority: s.priority, syncedAt: nowIso() };
    }
    if (connection.provider === "asana") {
      const s = await fetchAsanaStatus(cred.accessToken, existingRef.externalId);
      return { ...existingRef, externalStatus: s.status, externalPriority: s.priority, syncedAt: nowIso() };
    }
    if (connection.provider === "trello") {
      const card = await fetchTrelloCard(cred, existingRef.externalId);
      const status = connection.doneListId && card.idList === connection.doneListId ? "done" : "open";
      return { ...existingRef, externalStatus: status, externalPriority: null, syncedAt: nowIso() };
    }
    return existingRef;
  }

  app.post("/api/tasktracker/:id/revoke", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    c.status = "revoked";
    c.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: c.id, status: c.status });
  });

  app.delete("/api/tasktracker/:id", requireAuth, async (req, res) => {
    const c = findMine(req, req.params.id);
    if (!c) return res.status(404).json({ error: "Connection not found." });
    db.data.taskTrackerConnections = (db.data.taskTrackerConnections || []).filter(x => x.id !== c.id);
    await db.write();
    res.json({ ok: true, id: c.id });
  });

  console.log("ShieldAI task tracker integration routes registered.");
}
