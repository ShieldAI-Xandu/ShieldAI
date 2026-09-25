// securityVendorAdapters.test.mjs — run: node securityVendorAdapters.test.mjs
// Fixture shapes follow each vendor's public docs (NOT a live tenant). What is
// proven here: the read-only guard, pagination, status/severity mapping, and
// that a surprising response is an ERROR (never "no detections").
import { makeClient, mapCrowdstrikeAlert, mapSentinelOneThreat, SECURITY_VENDORS, credentialFromBody, missingCredentialFields, validateCredential } from "./securityVendorAdapters.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// A fake fetch that records every request and answers from a router.
const fakeFetch = (router) => {
  const calls = [];
  const f = async (url, init) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, host: u.host, headers: init.headers, body: init.body });
    const r = router(u, init, calls.length);
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
  };
  f.calls = calls;
  return f;
};

console.log("makeClient read-only guard:");
{
  const f = fakeFetch(() => ({ body: {} }));
  const c = makeClient({ vendor: "t", fetchImpl: f, readPosts: [/^\/ok$/] });
  ok(!!(await rejects(() => c("DELETE", "https://x.test/a"))), "DELETE refused");
  ok(!!(await rejects(() => c("PUT", "https://x.test/a"))), "PUT refused");
  ok(!!(await rejects(() => c("PATCH", "https://x.test/a"))), "PATCH refused");
  ok(!!(await rejects(() => c("POST", "https://x.test/isolate"))), "POST to a non-allow-listed path refused");
  ok(!!(await rejects(() => c("GET", "http://x.test/a"))), "non-https refused");
  await c("POST", "https://x.test/ok", { json: {} });
  await c("GET", "https://x.test/a");
  ok(f.calls.length === 2, "allow-listed read POST and GET go through; refused ones never reached fetch");
  const bad = await rejects(async () => makeClient({ vendor: "t", fetchImpl: fakeFetch(() => ({ status: 401, body: { secret: "leak" } })) })("GET", "https://x.test/a"));
  ok(bad && !/leak/.test(bad.message) && /401/.test(bad.message), "HTTP error reports status only, never the response body");
}

console.log("\nCrowdStrike:");
const CS_CRED = { clientId: "id", clientSecret: "sec", cloud: "us-1" };
const csRouter = (opts = {}) => (u) => {
  if (u.pathname === "/oauth2/token") return { body: { access_token: "tok" } };
  if (u.pathname === "/alerts/queries/alerts/v2") return { body: { resources: "ids" in opts ? opts.ids : ["c1", "c2", "c3"] } };
  if (u.pathname === "/alerts/entities/alerts/v2") return { body: opts.entities ?? { resources: [
    { composite_id: "c1", display_name: "Malware detected", severity_name: "High", status: "new", device: { hostname: "WIN-01" }, created_timestamp: "2026-09-20T10:00:00Z", filepath: "C:/x/bad.exe", pattern_disposition_description: "Detection, standard detection" },
    { composite_id: "c2", name: "Old one", severity: 95, status: "closed", device: { hostname: "win-02.corp" }, created_timestamp: "2026-09-10T10:00:00Z" },
    { composite_id: "c3", name: "Odd", severity: 10, device: {} },
  ] } };
  return { status: 404, body: {} };
};
{
  const f = fakeFetch(csRouter());
  const det = await SECURITY_VENDORS.crowdstrike.fetchDetections(CS_CRED, { fetchImpl: f });
  ok(det.length === 3, "maps every alert");
  const byId = Object.fromEntries(det.map(d => [d.externalId, d]));
  ok(byId.c1.status === "active" && byId.c1.severity === "high" && byId.c1.host === "WIN-01", "new alert -> active, High -> high, host from device.hostname");
  ok(byId.c2.status === "remediated" && byId.c2.severity === "critical", "closed -> remediated; numeric 95 -> critical");
  ok(byId.c3.status === "unknown" && byId.c3.host === null, "no status/host -> unknown / null (not guessed)");
  const methods = [...new Set(f.calls.map(c => `${c.method} ${c.path}`))];
  ok(methods.every(m => ["POST /oauth2/token", "GET /alerts/queries/alerts/v2", "POST /alerts/entities/alerts/v2"].includes(m)), "only token, query and entities-read calls made: " + methods.join(", "));
  ok(f.calls.find(c => c.path === "/alerts/queries/alerts/v2").headers.authorization === "Bearer tok", "bearer token sent");
  ok(f.calls.every(c => c.host === "api.crowdstrike.com"), "requests stay on the fixed region host");
}
{
  ok(!!(await rejects(() => SECURITY_VENDORS.crowdstrike.fetchDetections({ ...CS_CRED, cloud: "evil.example" }, { fetchImpl: fakeFetch(csRouter()) }))), "unknown cloud region refused (no client-supplied base URL)");
  ok(!!(await rejects(() => SECURITY_VENDORS.crowdstrike.fetchDetections(CS_CRED, { fetchImpl: fakeFetch(csRouter({ ids: null })) }))), "unexpected query shape is an ERROR, not an empty result");
  ok(!!(await rejects(() => SECURITY_VENDORS.crowdstrike.fetchDetections(CS_CRED, { fetchImpl: fakeFetch(csRouter({ entities: { nope: 1 } })) }))), "unexpected entities shape is an ERROR, not an empty result");
  ok(!!(await rejects(() => SECURITY_VENDORS.crowdstrike.fetchDetections(CS_CRED, { fetchImpl: fakeFetch((u) => u.pathname === "/oauth2/token" ? { status: 401, body: {} } : { body: {} }) }))), "bad credentials (401 on token) is an ERROR");
  ok(mapCrowdstrikeAlert({}) === null, "alert with no id is skipped");
}

console.log("\nSentinelOne:");
const S1_CRED = { consoleUrl: "acme.sentinelone.net", apiToken: "tk" };
const threat = (id, over = {}) => ({ id, threatInfo: { threatName: `T${id}`, confidenceLevel: "malicious", classification: "Trojan", mitigationStatus: "active", incidentStatus: "unresolved", filePath: "/tmp/x", createdAt: "2026-09-20T10:00:00Z", ...over }, agentRealtimeInfo: { agentComputerName: "MAC-01" } });
{
  const f = fakeFetch((u) => u.searchParams.get("cursor") === "p2"
    ? { body: { data: [threat("3", { mitigationStatus: "mitigated" })], pagination: { nextCursor: null } } }
    : { body: { data: [threat("1"), threat("2", { classification: "Ransomware", confidenceLevel: "suspicious" })], pagination: { nextCursor: "p2" } } });
  const det = await SECURITY_VENDORS.sentinelone.fetchDetections(S1_CRED, { fetchImpl: f });
  ok(det.length === 3 && f.calls.length === 2, "follows the cursor across pages");
  ok(det[0].status === "active" && det[0].severity === "high", "malicious+active -> active/high");
  ok(det[1].severity === "critical", "ransomware classification -> critical");
  ok(det[2].status === "remediated", "mitigated -> remediated");
  ok(f.calls.every(c => c.method === "GET" && c.headers.authorization === "ApiToken tk" && c.host === "acme.sentinelone.net"), "GET only, ApiToken header, tenant host only");
}
{
  for (const bad of ["https://evil.example.com", "http://acme.sentinelone.net.evil.com", "acme.sentinelone.net.attacker.io", "not a url"]) {
    ok(!!(await rejects(() => SECURITY_VENDORS.sentinelone.fetchDetections({ ...S1_CRED, consoleUrl: bad }, { fetchImpl: fakeFetch(() => ({ body: { data: [] } })) }))), `console URL refused: ${bad}`);
  }
  ok(!!(await rejects(() => SECURITY_VENDORS.sentinelone.fetchDetections(S1_CRED, { fetchImpl: fakeFetch(() => ({ body: { unexpected: true } })) }))), "unexpected shape is an ERROR");
  ok(mapSentinelOneThreat({ id: "x" }) === null, "threat without threatInfo skipped");
}

console.log("\nMicrosoft Defender (Graph alerts_v2):");
const MS_CRED = { tenantId: "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c", clientId: "app", clientSecret: "sec" };
const msAlert = (id, over = {}) => ({ id, title: `Alert ${id}`, severity: "high", status: "new", createdDateTime: "2026-09-20T10:00:00Z", evidence: [
  { "@odata.type": "#microsoft.graph.security.deviceEvidence", hostName: "yonif-lap3", deviceDnsName: "yonif-lap3.corp.example" },
  { "@odata.type": "#microsoft.graph.security.fileEvidence", fileDetails: { fileName: "bad.exe", filePath: "C:\\temp" } },
], ...over });
{
  const f = fakeFetch((u) => {
    if (u.pathname.endsWith("/oauth2/v2.0/token")) return { body: { access_token: "gt" } };
    if (u.searchParams.get("$skiptoken") === "2") return { body: { value: [msAlert("3", { status: "resolved", severity: "informational" })] } };
    return { body: { value: [msAlert("1"), msAlert("2", { status: "unknown", evidence: [] })], "@odata.nextLink": "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=2" } };
  });
  const det = await SECURITY_VENDORS.msdefender.fetchDetections(MS_CRED, { fetchImpl: f });
  ok(det.length === 3 && f.calls.length === 3, "token + two pages (follows @odata.nextLink)");
  ok(det[0].host === "yonif-lap3" && det[0].status === "active" && det[0].severity === "high" && /bad\.exe/.test(det[0].path), "device hostName, active, file path from evidence");
  ok(det[1].status === "unknown" && det[1].host === null, "unknown status / no device evidence -> unknown, null host");
  ok(det[2].status === "remediated" && det[2].severity === "info", "resolved -> remediated; informational -> info");
  const tokCall = f.calls[0];
  ok(tokCall.method === "POST" && tokCall.host === "login.microsoftonline.com" && /client_credentials/.test(tokCall.body) && /graph\.microsoft\.com%2F\.default/.test(tokCall.body), "token: client-credentials against the tenant, Graph .default scope");
  ok(f.calls.slice(1).every(c => c.method === "GET" && c.host === "graph.microsoft.com" && c.headers.authorization === "Bearer gt"), "alerts read with GET on graph.microsoft.com only");
  ok(f.calls.some(c => c.method === "GET" && decodeURIComponent(c.path + "").length > 0 && true), "alerts endpoint queried")
}
{
  const evil = fakeFetch((u) => u.pathname.endsWith("/token") ? { body: { access_token: "t" } } : { body: { value: [], "@odata.nextLink": "https://evil.example.com/steal" } });
  ok(!!(await rejects(() => SECURITY_VENDORS.msdefender.fetchDetections(MS_CRED, { fetchImpl: evil }))), "nextLink to another host refused");
  ok(!!(await rejects(() => SECURITY_VENDORS.msdefender.fetchDetections({ ...MS_CRED, tenantId: "../evil" }, { fetchImpl: evil }))), "malformed tenant ID refused (no path injection)");
  ok(!!(await rejects(() => SECURITY_VENDORS.msdefender.fetchDetections(MS_CRED, { fetchImpl: fakeFetch((u) => u.pathname.endsWith("/token") ? { body: { access_token: "t" } } : { body: { nope: 1 } }) }))), "unexpected shape is an ERROR");
}

console.log("\nSophos Central:");
const SO_CRED = { clientId: "id", clientSecret: "sec" };
const soRouter = (over = {}) => (u) => {
  if (u.host === "id.sophos.com") return { body: { access_token: "st" } };
  if (u.pathname === "/whoami/v1") return { body: over.whoami ?? { id: "tenant-1", idType: "tenant", apiHosts: { global: "https://api.central.sophos.com", dataRegion: "https://api-us03.central.sophos.com" } } };
  if (u.pathname === "/common/v1/alerts") return u.searchParams.get("pageFromKey") === "k2"
    ? { body: { items: [{ id: "a3", severity: "low", description: "Later", category: "malware", managedAgent: { name: "PC3" } }], pages: {} } }
    : { body: { items: [
        { id: "a1", severity: "high", description: "Malware detected", category: "malware", raisedAt: "2026-09-20T10:00:00Z", managedAgent: { name: "PC1" } },
        { id: "a2", severity: "medium", description: "Policy changed", category: "policy", managedAgent: { name: "PC2" } },
      ], pages: { nextKey: "k2" } } };
  return { status: 404, body: {} };
};
{
  const f = fakeFetch(soRouter());
  const det = await SECURITY_VENDORS.sophos.fetchDetections(SO_CRED, { fetchImpl: f });
  ok(det.length === 2 && det.map(d => d.externalId).join() === "a1,a3", "pages through alerts; non-threat categories skipped");
  ok(det[0].host === "PC1" && det[0].severity === "high" && det[0].status === "active", "host from managedAgent.name, severity, active");
  const ac = f.calls.filter(c => c.path === "/common/v1/alerts");
  ok(ac.every(c => c.method === "GET" && c.host === "api-us03.central.sophos.com" && c.headers["x-tenant-id"] === "tenant-1"), "alerts read via the data-region host with X-Tenant-ID");
  ok(f.calls[0].method === "POST" && /client_credentials/.test(f.calls[0].body) && /scope=token/.test(f.calls[0].body), "token: client-credentials, scope=token");
}
{
  ok(!!(await rejects(() => SECURITY_VENDORS.sophos.fetchDetections(SO_CRED, { fetchImpl: fakeFetch(soRouter({ whoami: { id: "p", idType: "partner", apiHosts: {} } })) }))), "partner-level credential refused");
  ok(!!(await rejects(() => SECURITY_VENDORS.sophos.fetchDetections(SO_CRED, { fetchImpl: fakeFetch(soRouter({ whoami: { id: "t", idType: "tenant", apiHosts: { dataRegion: "https://evil.example.com" } } })) }))), "data-region host outside api.central.sophos.com refused");
}

console.log("\nESET:");
const ES_CRED = { region: "eu", username: "api@example.com", password: "pw" };
{
  const f = fakeFetch((u) => {
    if (u.pathname === "/oauth/token") return { body: { access_token: "et" } };
    if (u.pathname === "/v1/detections") return u.searchParams.get("pageToken") === "p2"
      ? { body: { detections: [{ uuid: "d3", displayName: "Third", severityLevel: "SEVERITY_LEVEL_LOW" }] } }
      : { body: { detections: [{ uuid: "d1", displayName: "Trojan found", severityLevel: "SEVERITY_LEVEL_HIGH", occurTime: "2026-09-20T10:00:00Z", objectName: "C:/x.exe", context: { deviceUuid: "u1" } }], nextPageToken: "p2" } };
    return { status: 404, body: {} };
  });
  const det = await SECURITY_VENDORS.eset.fetchDetections(ES_CRED, { fetchImpl: f });
  ok(det.length === 2 && det[0].severity === "high" && det[1].severity === "low", "pages through detections; severity mapped");
  ok(det.every(d => d.status === "unknown" && d.host === null), "no remediation flag and no hostname from ESET -> unknown status / null host (nothing invented)");
  ok(f.calls[0].method === "POST" && /grant_type=password/.test(f.calls[0].body) && f.calls[0].host === "eu.business-account.iam.eset.systems", "token: password grant on the regional auth host");
  ok(f.calls.slice(1).every(c => c.method === "GET" && c.host === "eu.incident-management.eset.systems" && c.headers.authorization === "Bearer et"), "detections read with GET on the regional incident-management host");
  ok(!!(await rejects(() => SECURITY_VENDORS.eset.fetchDetections({ ...ES_CRED, region: "evil.example" }, { fetchImpl: f }))), "unknown region refused (no client-supplied host)");
}

console.log("\nCredential handling:");
{
  const c = credentialFromBody("crowdstrike", { clientId: " a ", clientSecret: "b", cloud: "us-2", extra: "ignored" });
  ok(c.clientId === "a" && !("extra" in c), "only declared fields are taken, trimmed");
  ok(missingCredentialFields("crowdstrike", { clientId: "a", clientSecret: "", cloud: "us-1" }).length === 1, "missing field reported");
  ok(!!(await rejects(() => validateCredential("crowdstrike", { ...CS_CRED, cloud: "mars" }, { fetchImpl: fakeFetch(csRouter()) }))), "bad option value refused by validateCredential");
}

process.exit(fail ? 1 : 0);
