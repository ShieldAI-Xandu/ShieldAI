// securityVendorAdapters.js
// Per-vendor connectors for securityVendorRoutes.js: pull the malware/threat
// DETECTIONS a client's own AV/EDR product has already recorded in its cloud
// console, so the platform can show them even when the endpoint agent cannot
// read them locally (CrowdStrike, SentinelOne, ... keep detections in the
// cloud, not on the host).
//
// SCOPE BOUNDARY (read before adding a vendor or a permission): every call
// below is a READ. The credential the client pastes must be the vendor's
// read-only role/scope (CrowdStrike "Alerts: Read", SentinelOne Viewer-role
// user, ...). This file must never call a response/remediation/management
// endpoint — same rule cloudAdapters.js and directoryAdapters.js document, and
// the "AI advises, humans act" boundary in CLAUDE.md. It is enforced in code:
// every request goes through makeClient(), which refuses any method other than
// GET unless the URL matches that vendor's explicit allow-list of read-only
// POSTs (its OAuth token endpoint and query-by-id "entities" reads).
//
// Detections are normalized to metadata only:
//   { externalId, host, title, severity, detectedAt, status, action, path }
// `status` is "active" (still needs attention per the vendor), "remediated"
// (vendor says handled/closed) or "unknown". Severity is computed HERE,
// deterministically, from fields the vendor returned — never by the AI layer.
//
// CONFIDENCE NOTE: endpoint paths and field names are from each vendor's
// public API documentation, NOT verified against a live tenant (same caveat
// cloudAdapters.js carries). Every vendor is "unverified against live" until it
// has been run against a real trial/partner tenant — read defensively, and
// treat a shape surprise as an error (poll fails -> status stays "unknown"),
// never as "no detections".
//
// SSRF: the base URL is never taken verbatim from the client. CrowdStrike
// uses a fixed region allow-list; SentinelOne's console URL must be an
// https://*.sentinelone.net host.

const CANON = new Set(["critical", "high", "medium", "low", "info"]);
const canonSev = (s) => (CANON.has(String(s || "").toLowerCase()) ? String(s).toLowerCase() : "medium");
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, n);
const MAX_DETECTIONS = 2000;           // hard ceiling per poll
const LOOKBACK_DAYS = 30;              // how far back a poll looks

// ── read-only HTTP client ─────────────────────────────────────────────
// readPosts: RegExps (tested against the URL pathname) for POST endpoints that
// are reads: the vendor's OAuth token endpoint and id-lookup "entities" calls.
export function makeClient({ vendor, fetchImpl = fetch, readPosts = [], timeoutMs = 20000 }) {
  return async function request(method, url, { headers = {}, form, json, query } = {}) {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error(`${vendor}: refusing non-https request`);
    if (query) for (const [k, v] of Object.entries(query)) if (v != null) u.searchParams.set(k, String(v));
    const m = String(method).toUpperCase();
    if (m !== "GET" && !(m === "POST" && readPosts.some(rx => rx.test(u.pathname)))) {
      throw new Error(`${vendor}: refusing non-read request ${m} ${u.pathname}`);
    }
    const init = { method: m, headers: { accept: "application/json", ...headers } };
    if (form) { init.headers["content-type"] = "application/x-www-form-urlencoded"; init.body = new URLSearchParams(form).toString(); }
    if (json) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(json); }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u.toString(), { ...init, signal: ctrl.signal });
      // Status only — never echo the response body: it can contain tenant data
      // and error bodies occasionally reflect credentials.
      if (!res.ok) throw new Error(`${vendor}: HTTP ${res.status} from ${u.pathname}`);
      return await res.json();
    } finally { clearTimeout(t); }
  };
}

const sinceIsoDefault = () => new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

// ── CrowdStrike Falcon ────────────────────────────────────────────────
// Auth: OAuth2 client-credentials. API client scope needed: "Alerts: Read"
// ONLY. Alerts API v2: GET queries (ids) then POST entities (composite_ids) —
// the entities POST is a read; it is allow-listed by path below.
const CS_CLOUDS = {
  "us-1": "https://api.crowdstrike.com",
  "us-2": "https://api.us-2.crowdstrike.com",
  "eu-1": "https://api.eu-1.crowdstrike.com",
};
const CS_READ_POSTS = [/^\/oauth2\/token$/, /^\/alerts\/entities\/alerts\/v2$/];

const CS_SEV = { critical: "critical", high: "high", medium: "medium", low: "low", informational: "info" };
function csSeverity(a) {
  const byName = CS_SEV[String(a.severity_name || "").toLowerCase()];
  if (byName) return byName;
  const n = Number(a.severity);                     // 0-100 scale
  if (Number.isFinite(n)) return n >= 90 ? "critical" : n >= 70 ? "high" : n >= 40 ? "medium" : n >= 20 ? "low" : "info";
  return "medium";
}

async function csToken(client, base, { clientId, clientSecret }) {
  const r = await client("POST", `${base}/oauth2/token`, { form: { client_id: clientId, client_secret: clientSecret } });
  if (!r?.access_token) throw new Error("crowdstrike: token response had no access_token");
  return r.access_token;
}

export function mapCrowdstrikeAlert(a) {
  if (!a || !(a.composite_id || a.id)) return null;
  const st = String(a.status || "").toLowerCase();
  const remediated = st === "closed";
  return {
    externalId: String(a.composite_id || a.id),
    host: clip(a.device?.hostname || a.hostname || "", 200) || null,
    title: clip(a.display_name || a.name || a.description || "CrowdStrike detection", 300),
    severity: csSeverity(a),
    detectedAt: a.created_timestamp || a.timestamp || null,
    status: remediated ? "remediated" : (st ? "active" : "unknown"),
    action: clip(a.pattern_disposition_description || a.status || "", 200) || null,
    path: clip(a.filepath || a.filename || "", 300) || null,
  };
}

async function fetchCrowdstrikeDetections(cred, { sinceIso = sinceIsoDefault(), fetchImpl } = {}) {
  const base = CS_CLOUDS[cred.cloud];
  if (!base) throw new Error("crowdstrike: unknown cloud region");
  const client = makeClient({ vendor: "crowdstrike", fetchImpl, readPosts: CS_READ_POSTS });
  const token = await csToken(client, base, cred);
  const auth = { authorization: `Bearer ${token}` };
  const filter = `product:'epp'+created_timestamp:>='${sinceIso}'`;

  const ids = [];
  for (let offset = 0; ids.length < MAX_DETECTIONS; ) {
    const q = await client("GET", `${base}/alerts/queries/alerts/v2`, { headers: auth, query: { filter, limit: 500, offset, sort: "created_timestamp.desc" } });
    if (!Array.isArray(q?.resources)) throw new Error("crowdstrike: unexpected query response shape");
    ids.push(...q.resources);
    if (q.resources.length < 500) break;
    offset += q.resources.length;
  }
  const out = [];
  for (let i = 0; i < ids.length && i < MAX_DETECTIONS; i += 500) {
    const e = await client("POST", `${base}/alerts/entities/alerts/v2`, { headers: auth, json: { composite_ids: ids.slice(i, i + 500) } });
    if (!Array.isArray(e?.resources)) throw new Error("crowdstrike: unexpected entities response shape");
    for (const a of e.resources) { const m = mapCrowdstrikeAlert(a); if (m) out.push(m); }
  }
  return out;
}

// ── SentinelOne ───────────────────────────────────────────────────────
// Auth: `Authorization: ApiToken <token>` from a dedicated Viewer-role console
// user (a token inherits its creator's role — a Viewer token cannot act).
// Read: GET /web/api/v2.1/threats, cursor-paginated.
function s1Base(consoleUrl) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(consoleUrl) ? consoleUrl : `https://${consoleUrl}`); } catch { throw new Error("sentinelone: console URL is not a valid URL"); }
  if (u.protocol !== "https:" || !/\.sentinelone\.net$/i.test(u.hostname)) {
    throw new Error("sentinelone: console URL must be an https://<your-tenant>.sentinelone.net address");
  }
  return `https://${u.hostname.toLowerCase()}`;
}

const S1_REMEDIATED = new Set(["mitigated", "blocked", "suspicious_resolved"]);
function s1Severity(info) {
  const cls = String(info.classification || "").toLowerCase();
  const conf = String(info.confidenceLevel || "").toLowerCase();
  if (/ransom/.test(cls)) return "critical";
  if (conf === "malicious") return "high";
  if (conf === "suspicious") return "medium";
  return "medium";
}

export function mapSentinelOneThreat(t) {
  const info = t?.threatInfo;
  if (!t?.id || !info) return null;
  const mit = String(info.mitigationStatus || "").toLowerCase();
  const inc = String(info.incidentStatus || "").toLowerCase();
  const remediated = S1_REMEDIATED.has(mit) || inc === "resolved";
  return {
    externalId: String(t.id),
    host: clip(t.agentRealtimeInfo?.agentComputerName || t.agentDetectionInfo?.agentComputerName || "", 200) || null,
    title: clip(info.threatName || info.classification || "SentinelOne threat", 300),
    severity: s1Severity(info),
    detectedAt: info.createdAt || info.identifiedAt || null,
    status: remediated ? "remediated" : (mit || inc ? "active" : "unknown"),
    action: clip(info.mitigationStatus || info.incidentStatus || "", 200) || null,
    path: clip(info.filePath || "", 300) || null,
  };
}

async function fetchSentinelOneDetections(cred, { sinceIso = sinceIsoDefault(), fetchImpl } = {}) {
  const base = s1Base(cred.consoleUrl);
  const client = makeClient({ vendor: "sentinelone", fetchImpl, readPosts: [] });   // GET only
  const headers = { authorization: `ApiToken ${cred.apiToken}` };
  const out = [];
  let cursor = null;
  do {
    const r = await client("GET", `${base}/web/api/v2.1/threats`, { headers, query: { limit: 100, createdAt__gte: sinceIso, sortBy: "createdAt", sortOrder: "desc", cursor } });
    if (!Array.isArray(r?.data)) throw new Error("sentinelone: unexpected threats response shape");
    for (const t of r.data) { const m = mapSentinelOneThreat(t); if (m) out.push(m); }
    cursor = r.pagination?.nextCursor || null;
  } while (cursor && out.length < MAX_DETECTIONS);
  return out;
}

// ── Microsoft Defender for Business / Endpoint (Graph alerts_v2) ──────
// Auth: Entra app registration, client credentials, APPLICATION permission
// SecurityAlert.Read.All (the least-privileged read permission; admin consent).
// Read: GET https://graph.microsoft.com/v1.0/security/alerts_v2 with $filter,
// paged via @odata.nextLink (only followed if it stays on graph.microsoft.com).
// Source: Microsoft Learn "List alerts_v2" (fetched live). Status enum per docs:
// new | inProgress | resolved | unknown. Only Defender for Endpoint alerts are
// requested (this is what Defender for Business runs on).
const GRAPH_HOST = "graph.microsoft.com";
const MS_TENANT_RX = /^([0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}|[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+)$/;
const MS_READ_POSTS = [/^\/[^/]+\/oauth2\/v2\.0\/token$/];
const MS_SEV = { informational: "info", low: "low", medium: "medium", high: "high" };

export function mapDefenderAlert(a) {
  if (!a?.id) return null;
  const st = String(a.status || "").toLowerCase();
  const ev = Array.isArray(a.evidence) ? a.evidence : [];
  const dev = ev.find(e => /deviceEvidence$/i.test(String(e?.["@odata.type"] || "")));
  const file = ev.find(e => /fileEvidence$/i.test(String(e?.["@odata.type"] || "")));
  const host = dev?.hostName || dev?.deviceDnsName || null;
  const fd = file?.fileDetails;
  return {
    externalId: String(a.id),
    host: clip(host || "", 200) || null,
    title: clip(a.title || a.threatDisplayName || "Microsoft Defender alert", 300),
    severity: MS_SEV[String(a.severity || "").toLowerCase()] || "medium",
    detectedAt: a.createdDateTime || null,
    status: st === "resolved" ? "remediated" : (st === "new" || st === "inprogress") ? "active" : "unknown",
    action: clip(a.status || "", 200) || null,
    path: clip(fd ? `${fd.filePath || ""}${fd.filePath && fd.fileName ? "/" : ""}${fd.fileName || ""}` : "", 300) || null,
  };
}

async function fetchDefenderDetections(cred, { sinceIso = sinceIsoDefault(), fetchImpl } = {}) {
  if (!MS_TENANT_RX.test(cred.tenantId)) throw new Error("msdefender: tenant ID must be a GUID or a domain name");
  const client = makeClient({ vendor: "msdefender", fetchImpl, readPosts: MS_READ_POSTS });
  const tok = await client("POST", `https://login.microsoftonline.com/${cred.tenantId}/oauth2/v2.0/token`, {
    form: { client_id: cred.clientId, client_secret: cred.clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" },
  });
  if (!tok?.access_token) throw new Error("msdefender: token response had no access_token");
  const headers = { authorization: `Bearer ${tok.access_token}` };
  const out = [];
  let url = `https://${GRAPH_HOST}/v1.0/security/alerts_v2`;
  let query = { $filter: `serviceSource eq 'microsoftDefenderForEndpoint' and createdDateTime ge ${sinceIso}`, $top: 100 };
  while (url && out.length < MAX_DETECTIONS) {
    const r = await client("GET", url, { headers, query });
    if (!Array.isArray(r?.value)) throw new Error("msdefender: unexpected alerts response shape");
    for (const a of r.value) { const m = mapDefenderAlert(a); if (m) out.push(m); }
    const next = r["@odata.nextLink"];
    if (next && new URL(next).host !== GRAPH_HOST) throw new Error("msdefender: refusing nextLink to another host");
    url = next || null; query = undefined;                 // the nextLink already carries its own query
  }
  return out;
}

// ── Sophos Central (Common API alerts) ────────────────────────────────
// Auth: a TENANT-level API credential (Central Admin > API Credentials) with the
// "Service Principal Read-Only" role: OAuth2 client-credentials at id.sophos.com,
// then /whoami/v1 for the tenant ID and the data-region API host. Partner and
// organization-level credentials are refused (they span many tenants).
// Read: GET {dataRegion}/common/v1/alerts?from=..&pageSize=..&pageFromKey=..
// Source: Sophos developer docs (auth flow fetched live); alert field names and
// the alert-presence == still-open assumption are NOT verified against a tenant.
const SOPHOS_READ_POSTS = [/^\/api\/v2\/oauth2\/token$/];
const SOPHOS_THREAT_CAT = /malware|runtime|ransom|exploit|threat|detect|pua|amsi|c2|mtr|behavio/i;

export function mapSophosAlert(a) {
  if (!a?.id) return null;
  if (a.category && !SOPHOS_THREAT_CAT.test(String(a.category))) return null;   // skip policy/update/connectivity noise
  return {
    externalId: String(a.id),
    host: clip(a.managedAgent?.name || "", 200) || null,
    title: clip(a.description || a.type || "Sophos alert", 300),
    severity: canonSev(a.severity),
    detectedAt: a.raisedAt || null,
    status: "active",              // listed == not yet cleared; the sink resolves it when it disappears from the window
    action: clip(a.category || "", 200) || null,
    path: null,
  };
}

async function fetchSophosDetections(cred, { sinceIso = sinceIsoDefault(), fetchImpl } = {}) {
  const client = makeClient({ vendor: "sophos", fetchImpl, readPosts: SOPHOS_READ_POSTS });
  const tok = await client("POST", "https://id.sophos.com/api/v2/oauth2/token", {
    form: { grant_type: "client_credentials", client_id: cred.clientId, client_secret: cred.clientSecret, scope: "token" },
  });
  if (!tok?.access_token) throw new Error("sophos: token response had no access_token");
  const auth = { authorization: `Bearer ${tok.access_token}` };
  const who = await client("GET", "https://api.central.sophos.com/whoami/v1", { headers: auth });
  if (who?.idType !== "tenant" || !who?.id) throw new Error("sophos: this must be a tenant-level API credential (not a partner or organization one)");
  let region;
  try { region = new URL(who.apiHosts?.dataRegion); } catch { throw new Error("sophos: whoami returned no data-region API host"); }
  if (region.protocol !== "https:" || !/^api(-[a-z0-9]+)?\.central\.sophos\.com$/i.test(region.hostname)) throw new Error("sophos: unexpected data-region API host");
  const base = `https://${region.hostname.toLowerCase()}`;
  const headers = { ...auth, "x-tenant-id": who.id };
  const out = [];
  let key = null;
  do {
    const r = await client("GET", `${base}/common/v1/alerts`, { headers, query: { from: sinceIso, pageSize: 100, pageFromKey: key } });
    if (!Array.isArray(r?.items)) throw new Error("sophos: unexpected alerts response shape");
    for (const a of r.items) { const m = mapSophosAlert(a); if (m) out.push(m); }
    key = r.pages?.nextKey || null;
  } while (key && out.length < MAX_DETECTIONS);
  return out;
}

// ── ESET (ESET Connect, Incident Management: list detections) ─────────
// Auth: a dedicated ESET Business Account API user (Integrations enabled, READ
// access only) exchanged for a 60-minute JWT via the password grant.
// Read: GET https://<region>.incident-management.eset.systems/v1/detections
// (startTime, pageSize <= 1000, pageToken; response: detections[], nextPageToken).
// Source: help.eset.com ESET Connect docs (detections endpoint fetched live).
// NOT verified: the auth host names below, and severityLevel's enum spelling.
// LIMITS (honest): a detection carries a device UUID, not a hostname, and no
// documented resolved/remediated flag — so detections are recorded with
// status "unknown" and no host. They appear in the connection's list and a
// human-review recommendation for high severity, but are NOT matched to
// endpoints or opened as vulnerabilities until a device-name lookup and the
// remediation field are verified against a real ESET tenant.
const ESET_REGIONS = ["eu", "de", "us", "ca", "jpn"];
const ESET_READ_POSTS = [/^\/oauth\/token$/];
function esetSeverity(s) {
  const v = String(s || "").toLowerCase();
  return /crit/.test(v) ? "critical" : /high/.test(v) ? "high" : /med|warn/.test(v) ? "medium" : /low/.test(v) ? "low" : /info/.test(v) ? "info" : "medium";
}

export function mapEsetDetection(d) {
  if (!d?.uuid) return null;
  return {
    externalId: String(d.uuid),
    host: null,
    title: clip(d.displayName || d.typeName || "ESET detection", 300),
    severity: esetSeverity(d.severityLevel),
    detectedAt: d.occurTime || null,
    status: "unknown",
    action: clip(d.category || "", 200) || null,
    path: clip(d.objectName || d.context?.process?.path || "", 300) || null,
  };
}

async function fetchEsetDetections(cred, { sinceIso = sinceIsoDefault(), fetchImpl } = {}) {
  if (!ESET_REGIONS.includes(cred.region)) throw new Error("eset: unknown region");
  const client = makeClient({ vendor: "eset", fetchImpl, readPosts: ESET_READ_POSTS });
  const tok = await client("POST", `https://${cred.region}.business-account.iam.eset.systems/oauth/token`, {
    form: { grant_type: "password", username: cred.username, password: cred.password, refresh_token: "" },
  });
  if (!tok?.access_token) throw new Error("eset: token response had no access_token");
  const headers = { authorization: `Bearer ${tok.access_token}` };
  const out = [];
  let pageToken = null;
  do {
    const r = await client("GET", `https://${cred.region}.incident-management.eset.systems/v1/detections`, { headers, query: { startTime: sinceIso, pageSize: 200, pageToken } });
    if (!Array.isArray(r?.detections)) throw new Error("eset: unexpected detections response shape");
    for (const d of r.detections) { const m = mapEsetDetection(d); if (m) out.push(m); }
    pageToken = r.nextPageToken || null;
  } while (pageToken && out.length < MAX_DETECTIONS);
  return out;
}

// ── registry ──────────────────────────────────────────────────────────
// fields: what the client pastes. `secret: true` fields are encrypted at rest
// and never returned. `accountLabel` is a short non-secret label for the UI.
export const SECURITY_VENDORS = {
  crowdstrike: {
    label: "CrowdStrike Falcon",
    fields: [
      { key: "clientId", label: "API client ID", secret: false },
      { key: "clientSecret", label: "API client secret", secret: true },
      { key: "cloud", label: "Falcon cloud", secret: false, options: Object.keys(CS_CLOUDS) },
    ],
    setupNote: "In the Falcon console go to Support and resources > API clients and keys, create a NEW API client and grant ONLY the \"Alerts\" scope with Read access (nothing else, no Write). Paste its client ID and secret, and pick the cloud your console runs in (us-1, us-2 or eu-1). ShieldAI vCISO only ever reads alert records.",
    accountLabel: (c) => `Falcon ${c.cloud}`,
    fetchDetections: fetchCrowdstrikeDetections,
  },
  sentinelone: {
    label: "SentinelOne",
    fields: [
      { key: "consoleUrl", label: "Console URL (https://your-tenant.sentinelone.net)", secret: false },
      { key: "apiToken", label: "API token", secret: true },
    ],
    setupNote: "In the SentinelOne console create a dedicated user with the Viewer role (read-only), then generate that user's API token and paste it with your console URL. A Viewer token can read threats but cannot take any response action.",
    accountLabel: (c) => { try { return new URL(/^https?:\/\//i.test(c.consoleUrl) ? c.consoleUrl : `https://${c.consoleUrl}`).hostname; } catch { return ""; } },
    fetchDetections: fetchSentinelOneDetections,
  },
  msdefender: {
    label: "Microsoft Defender for Business",
    fields: [
      { key: "tenantId", label: "Directory (tenant) ID", secret: false },
      { key: "clientId", label: "Application (client) ID", secret: false },
      { key: "clientSecret", label: "Client secret value", secret: true },
    ],
    setupNote: "In the Microsoft Entra admin center register a NEW application, add the API permission Microsoft Graph > Application permissions > SecurityAlert.Read.All (read-only, nothing else), grant admin consent, then create a client secret. Paste the tenant ID, application ID and the secret value. ShieldAI vCISO only reads Defender for Endpoint alerts.",
    accountLabel: (c) => c.tenantId,
    fetchDetections: fetchDefenderDetections,
  },
  sophos: {
    label: "Sophos Central",
    fields: [
      { key: "clientId", label: "API client ID", secret: false },
      { key: "clientSecret", label: "API client secret", secret: true },
    ],
    setupNote: "In Sophos Central go to Global Settings > API Credentials Management, add a credential with the \"Service Principal Read-Only\" role, and paste its client ID and secret. It must be a credential for YOUR tenant (not a partner or organization one). ShieldAI vCISO only reads alerts.",
    accountLabel: () => "Sophos Central",
    fetchDetections: fetchSophosDetections,
  },
  eset: {
    label: "ESET PROTECT",
    fields: [
      { key: "region", label: "ESET region", secret: false, options: ESET_REGIONS },
      { key: "username", label: "API user email", secret: false },
      { key: "password", label: "API user password", secret: true },
    ],
    setupNote: "In your ESET Business Account create a dedicated API user (not a normal admin), turn on Integrations, and give it READ access only to ESET PROTECT. Paste that user's email and password and pick your region. Detections are listed and flagged for review, but ESET does not yet tell us the affected device name or whether it was remediated, so they are not matched to endpoints or reported as clean.",
    accountLabel: (c) => `ESET ${c.region}`,
    fetchDetections: fetchEsetDetections,
  },
};

// Push-only vendors (no stored credential; they POST to the webhook framework in
// integrationRoutes.js) still need a display label for the shared sink.
export const PUSH_VENDOR_LABELS = { bitdefender: "Bitdefender GravityZone" };
export const vendorLabelOf = (id) => SECURITY_VENDORS[id]?.label || PUSH_VENDOR_LABELS[id] || String(id);

// Pulls exactly the declared fields out of a request body.
export function credentialFromBody(vendorId, body) {
  const v = SECURITY_VENDORS[vendorId];
  if (!v) return null;
  const cred = {};
  for (const f of v.fields) cred[f.key] = String(body?.[f.key] ?? "").trim().slice(0, 2000);
  return cred;
}
export function missingCredentialFields(vendorId, cred) {
  const v = SECURITY_VENDORS[vendorId];
  if (!v) return ["vendor"];
  return v.fields.filter(f => !cred[f.key]).map(f => f.label);
}
// Validates a credential with one live read (a 1-day lookback poll) — the same
// discipline cloudRoutes.js/directoryRoutes.js use before storing anything.
export async function validateCredential(vendorId, cred, opts = {}) {
  const v = SECURITY_VENDORS[vendorId];
  if (!v) throw new Error("Unknown vendor.");
  const bad = v.fields.find(f => f.options && !f.options.includes(cred[f.key]));
  if (bad) throw new Error(`Invalid ${bad.label}.`);
  await v.fetchDetections(cred, { sinceIso: new Date(Date.now() - 86400000).toISOString(), ...opts });
  return true;
}
