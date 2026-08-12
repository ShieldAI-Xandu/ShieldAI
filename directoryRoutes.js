// directoryRoutes.js
// Directory security-posture integrations: Microsoft 365/Entra ID and Google
// Workspace via delegated OAuth, Okta via a customer-supplied read-only API
// token. Pulls MFA/admin/stale-account/policy-gap facts on demand ("Sync
// now" — no scheduled polling in this pass) and turns them into draft
// recommendations, exactly like integrationRoutes.js does for webhook
// findings.
//
// BOUNDARY: every scope requested (see directoryAdapters.js's
// M365_SCOPES/GOOGLE_WORKSPACE_SCOPES) is read-only, and the Okta token is
// validated against a read-only call before being stored. This file never
// requests a write/management scope and never calls a write endpoint on any
// provider. That's what keeps a pull-based connector — ShieldAI's server
// calling INTO a client's own directory tenant — consistent with the
// "AI advises, humans act" / no-inbound-command boundary CLAUDE.md
// documents for the monitoring agent (agentRoutes.js): this is a different
// relationship (SaaS-to-SaaS delegated-consent API read) but the same
// underlying rule — ShieldAI can observe a client's environment, never
// change it.
//
// riskEngine.js note: none of this feeds the posture SCORE. That engine is
// a closed, 13-factor system by design (same principle as the NIST CSF
// "no assess()" rule) — a new data source becoming a 14th scoring input
// would silently re-weight every existing client's score. Directory facts
// instead land as draft recommendations in the same analyst queue
// integrationRoutes.js/agentRoutes.js already feed — a corroborating fact
// source, not a parallel score.
//
// Mount from server.js:
//   import { registerDirectoryRoutes } from "./directoryRoutes.js";
//   registerDirectoryRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson });
// Same signature shape as integrationRoutes.js — no analyst-scoping
// dependencies, because the direct analog (integrationRoutes.js) doesn't
// use any either; client routes are keyed to req.userId directly.

import { randomUUID, createHash } from "crypto";
import { counters } from "./tierGate.js";
import { encryptSecret, decryptSecret } from "./credentialCrypto.js";
import { DIRECTORY_PROVIDERS } from "./directoryAdapters.js";
import { assertSafeExternalHost } from "./outboundUrlSafety.js";
import { createPendingGrant, consumePendingGrant } from "./oauthPendingGrants.js";

const nowIso = () => new Date().toISOString();
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

const PROVIDER_LABELS = { m365: "Microsoft 365", google_workspace: "Google Workspace", okta: "Okta", zoom: "Zoom" };

// ── OAuth provider config (M365/Google/Zoom; Okta uses a pasted token) ──
const OAUTH_PROVIDERS = {
  m365: {
    // /organizations/ (not /common/) excludes personal Microsoft accounts —
    // only work/school tenants can consent, which is all that can satisfy
    // these scopes anyway.
    authorizeUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
    scope: () => [...DIRECTORY_PROVIDERS.m365.scopes, "openid", "profile", "offline_access"].join(" "),
    clientId: () => process.env.MS_GRAPH_CLIENT_ID,
    clientSecret: () => process.env.MS_GRAPH_CLIENT_SECRET,
    // Directory.Read.All/Policy.Read.All/Reports.Read.All are effectively
    // admin-only delegated scopes — prompt=consent surfaces Microsoft's own
    // admin-consent UI automatically when the signed-in user is a tenant
    // admin. A non-admin signing in here will see Microsoft's own "needs
    // admin approval" screen, which is the correct/expected outcome.
    extraAuthParams: { prompt: "consent" },
  },
  google_workspace: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: () => [...DIRECTORY_PROVIDERS.google_workspace.scopes, "openid", "email"].join(" "),
    clientId: () => process.env.GOOGLE_WORKSPACE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_WORKSPACE_CLIENT_SECRET,
    // access_type=offline + prompt=consent guarantee a refresh_token comes
    // back — Google only issues one on first consent otherwise.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  zoom: {
    // Marketplace OAuth app, multi-account model — matches how M365/Google
    // are built for many different customer tenants, not Zoom's simpler
    // single-account app variant.
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    scope: () => DIRECTORY_PROVIDERS.zoom.scopes.join(" "),
    clientId: () => process.env.ZOOM_CLIENT_ID,
    clientSecret: () => process.env.ZOOM_CLIENT_SECRET,
    extraAuthParams: {},
  },
};

// Reuses the existing APP_URL convention (billingRoutes.js, phishingRoutes.js,
// policyAcknowledgmentRoutes.js all already build public links this way) —
// no new env var needed for this.
function publicAppUrl() {
  return (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

function redirectUriFor(provider) {
  return `${publicAppUrl()}/api/directory/oauth/${provider}/callback`;
}

// No signature verification — this decodes our OWN just-received id_token
// from the provider's own token endpoint over TLS, used only to read a
// display-label claim (tenant id / hosted domain), never for an auth
// decision.
function decodeJwtPayload(token) {
  try {
    const seg = String(token).split(".")[1];
    const json = Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function exchangeCodeForTokens(provider, code) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriFor(provider),
    client_id: cfg.clientId() || "",
    client_secret: cfg.clientSecret() || "",
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token exchange failed (${res.status})`);
  return json; // { access_token, refresh_token, expires_in, id_token, ... }
}

async function refreshAccessToken(provider, refreshToken) {
  const cfg = OAUTH_PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: cfg.clientId() || "",
    client_secret: cfg.clientSecret() || "",
  });
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Token refresh failed (${res.status})`);
  return json; // { access_token, refresh_token?, expires_in, ... }
}

function ensureCollections(db) {
  db.data.directoryConnections ||= [];
}

// Public view of a connection — never leaks the encrypted secret.
function publicConnection(c) {
  return {
    id: c.id, provider: c.provider, kind: c.kind, label: c.label,
    tenantOrDomain: c.tenantOrDomain, status: c.status,
    connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt || null,
    lastSyncSummary: c.lastSyncSummary || null,
    revokedAt: c.revokedAt || null,
  };
}

function dedupeKeyFor(connectionId, f) {
  return sha256(`${connectionId}::${f.externalId || f.title}`);
}
function recDedupeKey(connectionId, findingDedupeKey) {
  return `directory::${connectionId}::${findingDedupeKey}`;
}

// Own copy of the build-drafts/AI-enrich pattern (mirrors
// integrationRoutes.js's, which itself mirrors agentRoutes.js's — this
// codebase's established convention is each ingestion source carries its
// own copy rather than sharing one, so as not to touch already-shipped
// logic in the other two files for a new, unrelated source).
function buildDraftsFromPosture({ findings, connection }) {
  const drafts = [];
  for (const f of findings) {
    if ((SEV_RANK[f.severity] ?? 0) < SEV_RANK.medium) continue;
    const dedupeKey = dedupeKeyFor(connection.id, f);
    drafts.push({
      dedupeKey: recDedupeKey(connection.id, dedupeKey),
      title: f.title,
      detail: [
        `${PROVIDER_LABELS[connection.provider] || connection.provider} (${connection.label}) reported: "${f.title}".`,
        f.message ? f.message : "",
      ].filter(Boolean).join(" "),
      severity: f.severity,
    });
  }
  return drafts;
}

async function aiEnrichPostureDrafts({ drafts, connection, owner, callClaudeText, extractJson }) {
  if (!callClaudeText || !extractJson || drafts.length === 0) return null;

  const items = drafts.map(d => ({ key: d.dedupeKey, title: d.title, severity: d.severity, detail: d.detail }));
  const system = `You are ShieldAI Mastermind, a senior virtual CISO. You turn raw directory security-posture facts (from Microsoft 365/Entra ID, Google Workspace, or Okta) into clear, prioritized remediation recommendations for a small/medium business.

You ONLY produce written recommendations for a human (the client's admin or their analyst) to act on. You never perform actions yourself. Be specific, practical, and concise; assume a non-expert reader.

Return ONLY valid minified JSON, no markdown fences, exactly:
{"recommendations":[{"key":"<echo the finding key>","title":"<short imperative title>","detail":"<2-4 sentences: what's wrong, why it matters for this business, and the concrete steps a human should take>","severity":"low|medium|high|critical","priority":1-5,"rationale":"<one sentence on urgency>"}]}
Keep one entry per finding key provided. Do not invent findings.`;
  const user = `Source: ${PROVIDER_LABELS[connection.provider] || connection.provider} (${connection.label}).\nCompany: ${owner?.companyName || "the client"}.\n\nFindings to turn into recommendations:\n${JSON.stringify(items)}\n\nReturn the JSON now.`;

  try {
    const text = await callClaudeText({ system, messages: [{ role: "user", content: user }], max_tokens: 1800 });
    const parsed = extractJson(text);
    const out = {};
    for (const r of (parsed?.recommendations || [])) {
      if (!r.key) continue;
      out[r.key] = {
        title: String(r.title || "").slice(0, 300),
        detail: String(r.detail || "").slice(0, 4000),
        severity: ["low", "medium", "high", "critical"].includes(r.severity) ? r.severity : undefined,
        priority: Number.isFinite(r.priority) ? r.priority : undefined,
        rationale: String(r.rationale || "").slice(0, 500),
      };
    }
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn("Mastermind AI directory-draft enrichment failed; using deterministic text:", err.message);
    return null;
  }
}

export function registerDirectoryRoutes(app, { db, requireAuth, gate, callClaudeText, extractJson }) {
  ensureCollections(db);

  // state -> { userId, provider, createdAt }. In-memory only: a short-lived
  // CSRF-binding value for the redirect round-trip, not user data — a
  // restart simply invalidates any in-flight connect attempt, which is fine.
  const oauthStates = new Map();
  function sweepStates() {
    const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
    for (const [k, v] of oauthStates) if (v.createdAt < cutoff) oauthStates.delete(k);
  }

  // ════════════════════════════════════════════════════════════
  //  CLIENT ROUTES (their own connections only)
  // ════════════════════════════════════════════════════════════

  app.get("/api/directory", requireAuth, (req, res) => {
    const mine = (db.data.directoryConnections || []).filter(c => c.ownerUserId === req.userId);
    res.json(mine.map(publicConnection));
  });

  app.get("/api/directory/:id", requireAuth, (req, res) => {
    const c = (db.data.directoryConnections || []).find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!c) return res.status(404).json({ error: "Directory connection not found." });
    res.json(publicConnection(c));
  });

  // ── Microsoft 365 / Google Workspace: OAuth redirect flow ──────
  // Returns the authorize URL as JSON rather than redirecting directly —
  // requireAuth only recognizes a Bearer header (this app has no cookie
  // session), which a plain browser navigation can't carry. The frontend
  // calls this via its normal authenticated fetch, then navigates the
  // browser to the URL it gets back.
  app.get("/api/directory/oauth/:provider/start", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    (req, res) => {
      const provider = req.params.provider;
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return res.status(400).json({ error: "Unknown directory provider." });
      if (!cfg.clientId() || !cfg.clientSecret()) {
        return res.status(500).json({ error: `${PROVIDER_LABELS[provider]} isn't configured on this server yet.` });
      }
      try {
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
      } catch (err) {
        console.error("Directory OAuth start error:", err.message);
        res.status(500).json({ error: "Could not start the connection flow." });
      }
    });

  // No requireAuth — the browser lands here straight from Microsoft/Google
  // with no Authorization header. The user is recovered from `state`.
  app.get("/api/directory/oauth/:provider/callback", async (req, res) => {
    const provider = req.params.provider;
    const appUrl = publicAppUrl();
    const fail = (reason) => res.redirect(`${appUrl}/?directoryError=${encodeURIComponent(reason)}&provider=${provider}`);

    try {
      const cfg = OAUTH_PROVIDERS[provider];
      if (!cfg) return fail("unknown_provider");

      const { code, state, error: providerError } = req.query;
      if (providerError) return fail(String(providerError).slice(0, 100));

      sweepStates();
      const stateEntry = state && oauthStates.get(String(state));
      if (!stateEntry) return fail("expired_or_invalid_state");
      oauthStates.delete(String(state)); // one-time use

      const tokens = await exchangeCodeForTokens(provider, code);
      if (!tokens.refresh_token) return fail("no_refresh_token");

      const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : {};
      let tenantOrDomain;
      if (provider === "m365") {
        tenantOrDomain = claims.tid || "unknown-tenant";
      } else if (provider === "zoom") {
        // Zoom's OAuth token response carries no id_token (openid scope
        // isn't requested) — one extra call to identify the connected
        // account for a readable label.
        tenantOrDomain = await fetch("https://api.zoom.us/v2/users/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }).then(r => r.ok ? r.json() : null).then(u => u?.account_id || u?.email || "unknown-account").catch(() => "unknown-account");
      } else {
        tenantOrDomain = claims.hd || claims.email || "unknown-domain";
      }

      // NOT attributed to anyone yet — completing this browser redirect
      // isn't proof of who should own the resulting connection (see
      // oauthPendingGrants.js). Only an authenticated call to /finish below
      // does that.
      const pendingId = createPendingGrant("directory", {
        provider,
        tenantOrDomain: String(tenantOrDomain).slice(0, 200),
        refreshToken: tokens.refresh_token,
      });

      res.redirect(`${appUrl}/?directoryOAuthPending=${pendingId}&provider=${provider}`);
    } catch (err) {
      console.error("Directory OAuth callback error:", err.message);
      fail("connect_failed");
    }
  });

  // Finish step: the connection is attributed to whoever calls THIS
  // (authenticated) — never to whoever completed the browser redirect at
  // /callback above. Closes a confused-deputy gap where an attacker could
  // mint a state, hand a victim the resulting genuine provider consent URL,
  // and have the victim's completed grant land in the attacker's account.
  app.post("/api/directory/oauth/finish", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      const pendingId = String(req.body?.pendingId || "");
      if (!pendingId) return res.status(400).json({ error: "Missing pendingId." });
      const grant = consumePendingGrant("directory", pendingId);
      if (!grant) return res.status(410).json({ error: "This connection attempt has expired or already been used — try connecting again." });

      const connection = {
        id: randomUUID(),
        ownerUserId: req.userId,
        provider: grant.provider,
        kind: "oauth",
        label: PROVIDER_LABELS[grant.provider],
        tenantOrDomain: grant.tenantOrDomain,
        status: "active",
        encryptedSecret: encryptSecret(grant.refreshToken),
        scopes: DIRECTORY_PROVIDERS[grant.provider].scopes,
        connectedAt: nowIso(),
        connectedBy: req.userId,
        lastSyncAt: null,
        lastSyncSummary: null,
        revokedAt: null,
      };
      db.data.directoryConnections.push(connection);
      await db.write();
      res.json({ ok: true, id: connection.id, provider: connection.provider });
    });

  // ── Okta: pasted read-only API token, no redirect ───────────────
  app.post("/api/directory/connect/okta", requireAuth,
    gate.capability("integrations"),
    gate.limit("integrations", counters.integrations),
    async (req, res) => {
      try {
        const label = String(req.body?.label || "Okta").slice(0, 200).trim();
        const oktaDomain = String(req.body?.oktaDomain || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
        const apiToken = String(req.body?.apiToken || "").trim();
        if (!oktaDomain || !apiToken) return res.status(400).json({ error: "Okta domain and API token are required." });

        // Unlike every other directory provider, Okta's domain is pasted by
        // the client rather than fixed by an OAuth app — the same
        // client-controls-the-host SSRF class the Teams webhook guard
        // exists for, so it gets the same guard.
        try {
          await assertSafeExternalHost(`https://${oktaDomain}`);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }

        // Validate the token actually works against a read-only endpoint
        // before storing it — same "prove it works" pattern as any
        // credential-entry form should have.
        const check = await fetch(`https://${oktaDomain}/api/v1/users?limit=1`, {
          headers: { Authorization: `SSWS ${apiToken}`, Accept: "application/json" },
        });
        if (!check.ok) {
          return res.status(400).json({ error: "Could not validate this Okta token — check the domain and that the token has read access." });
        }

        const connection = {
          id: randomUUID(),
          ownerUserId: req.userId,
          provider: "okta",
          kind: "token",
          label,
          tenantOrDomain: oktaDomain,
          status: "active",
          encryptedSecret: encryptSecret(apiToken),
          scopes: null,
          connectedAt: nowIso(),
          connectedBy: req.userId,
          lastSyncAt: null,
          lastSyncSummary: null,
          revokedAt: null,
        };
        db.data.directoryConnections.push(connection);
        await db.write();
        res.json({ ok: true, id: connection.id });
      } catch (err) {
        console.error("Okta connect error:", err.message);
        res.status(500).json({ error: "Could not connect to Okta." });
      }
    });

  // ── Sync: pull posture facts on demand, draft recommendations ──
  app.post("/api/directory/:id/sync", requireAuth, async (req, res) => {
    const connection = (db.data.directoryConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Directory connection not found." });
    if (connection.status === "revoked") return res.status(403).json({ error: "This connection has been revoked." });

    const adapter = DIRECTORY_PROVIDERS[connection.provider];
    if (!adapter) return res.status(400).json({ error: "Unknown provider for this connection." });

    try {
      let credential;
      if (connection.kind === "oauth") {
        const refreshToken = decryptSecret(connection.encryptedSecret);
        let refreshed;
        try {
          refreshed = await refreshAccessToken(connection.provider, refreshToken);
        } catch (err) {
          connection.status = "error";
          await db.write();
          return res.status(409).json({ error: `${connection.label} access has expired or was revoked — reconnect this integration.`, detail: err.message });
        }
        if (refreshed.refresh_token) connection.encryptedSecret = encryptSecret(refreshed.refresh_token);
        credential = { accessToken: refreshed.access_token, tenantOrDomain: connection.tenantOrDomain };
      } else {
        credential = { apiToken: decryptSecret(connection.encryptedSecret), oktaDomain: connection.tenantOrDomain };
      }

      const facts = await adapter.fetchPosture(credential);
      const findings = adapter.mapPostureToFindings(facts);

      const severityCounts = {};
      for (const f of findings) severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;

      db.data.recommendations ||= [];
      const candidateDrafts = buildDraftsFromPosture({ findings, connection });
      const newDrafts = candidateDrafts.filter(d => !db.data.recommendations.some(r =>
        r.dedupeKey === d.dedupeKey && !["completed", "declined"].includes(r.status)
      ));
      let enriched = null;
      if (newDrafts.length > 0) {
        const owner = (db.data.users || []).find(u => u.id === connection.ownerUserId);
        enriched = await aiEnrichPostureDrafts({ drafts: newDrafts, connection, owner, callClaudeText, extractJson });
      }
      for (const d of newDrafts) {
        const ai = enriched?.[d.dedupeKey];
        db.data.recommendations.push({
          id: randomUUID(),
          ownerUserId: connection.ownerUserId,
          directoryConnectionId: connection.id,
          dedupeKey: d.dedupeKey,
          origin: "ai",
          aiAuthored: !!ai,
          title: ai?.title || d.title,
          detail: ai?.detail || d.detail,
          severity: ai?.severity || d.severity,
          priority: ai?.priority ?? null,
          rationale: ai?.rationale || "",
          status: "suggested",
          createdAt: nowIso(),
          history: [{ at: nowIso(), actorType: "ai", actorId: null, status: "suggested",
            note: ai ? "Auto-drafted by Mastermind AI from a directory sync." : "Auto-drafted (rule-based) from a directory sync." }],
        });
      }

      connection.status = "active";
      connection.lastSyncAt = nowIso();
      connection.lastSyncSummary = { syncedAt: nowIso(), findingCount: findings.length, severityCounts, findings };
      await db.write();

      res.json({ ok: true, findingCount: findings.length, severityCounts, draftsCreated: newDrafts.length });
    } catch (err) {
      console.error("Directory sync error:", err.message);
      res.status(500).json({ error: "Could not sync this directory connection." });
    }
  });

  app.post("/api/directory/:id/revoke", requireAuth, async (req, res) => {
    const connection = (db.data.directoryConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Directory connection not found." });

    // Best-effort revoke at the provider — Google supports token revocation;
    // Microsoft refresh tokens simply expire; Okta has no client-callable
    // revoke for a bare API token (the org admin rotates it directly).
    if (connection.provider === "google_workspace") {
      try {
        const refreshToken = decryptSecret(connection.encryptedSecret);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
      } catch (err) {
        console.warn("Google token revoke (best-effort) failed:", err.message);
      }
    }

    connection.status = "revoked";
    connection.revokedAt = nowIso();
    await db.write();
    res.json({ ok: true, id: connection.id, status: connection.status });
  });

  app.delete("/api/directory/:id", requireAuth, async (req, res) => {
    const connection = (db.data.directoryConnections || []).find(c => c.id === req.params.id && c.ownerUserId === req.userId);
    if (!connection) return res.status(404).json({ error: "Directory connection not found." });
    db.data.directoryConnections = (db.data.directoryConnections || []).filter(c => c.id !== connection.id);
    await db.write();
    res.json({ ok: true, id: connection.id });
  });

  console.log("ShieldAI directory integration routes registered.");
}
