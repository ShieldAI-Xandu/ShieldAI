// securityVendorRoutes.test.mjs — run: node securityVendorRoutes.test.mjs
// Exercises the REAL route handlers, tier gate, sink and poller logic through
// a tiny fake app (house convention: no HTTP harness), with globalThis.fetch
// standing in for the vendor.
import { randomBytes } from "crypto";
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { registerSecurityVendorRoutes, syncConnection, avDetectionSourceFor, connectionIsHealthy, normHost } = await import("./securityVendorRoutes.js");
const { makeTierGate } = await import("./tierGate.js");
const { syncAgentFindings } = await import("./agentRoutes.js");

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

// ── fake vendor (CrowdStrike shapes) ──────────────────────────────────
let vendorMode = "ok";                 // ok | remediated | down | gone
let vendorCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  vendorCalls.push(`${init.method} ${u.pathname}`);
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (vendorMode === "down") return res({}, 503);
  if (u.pathname === "/oauth2/token") return res({ access_token: "tok" });
  if (u.pathname === "/alerts/queries/alerts/v2") return res({ resources: vendorMode === "gone" ? [] : ["c1", "c2"] });
  if (u.pathname === "/alerts/entities/alerts/v2") {
    return res({ resources: [
      { composite_id: "c1", display_name: "Malware detected", severity_name: "High", status: vendorMode === "remediated" ? "closed" : "new", device: { hostname: "WIN-01.corp.local" }, created_timestamp: new Date(Date.now() - 86400000).toISOString() },
      { composite_id: "c2", display_name: "Unmanaged host hit", severity_name: "Critical", status: "new", device: { hostname: "OTHER-PC" }, created_timestamp: new Date(Date.now() - 86400000).toISOString() },
    ] });
  }
  return res({}, 404);
};

// ── fake app / db ─────────────────────────────────────────────────────
const db = { data: { users: [
  { id: "u1", tier: "growth", companyName: "One" }, { id: "u2", tier: "growth", companyName: "Two" }, { id: "u3", tier: "free" },
], agents: [{ id: "a1", ownerUserId: "u1", hostname: "win-01", status: "active" }, { id: "a2", ownerUserId: "u2", hostname: "OTHER-PC", status: "active" }] }, write: async () => {} };
db.data.securityVendorConnections = []; db.data.vendorDetections = []; db.data.agentVulnerabilities = []; db.data.recommendations = [];
const gate = makeTierGate(db);
const routes = [];
const reg = (m) => (p, ...h) => routes.push({ m, p, h });
const app = { get: reg("GET"), post: reg("POST"), delete: reg("DELETE") };
registerSecurityVendorRoutes(app, { db, requireAuth: (req, res, next) => next(), gate, callClaudeText: null, extractJson: null, poll: false });

async function call(method, url, { userId, body = {}, staff = false } = {}) {
  for (const r of routes) {
    if (r.m !== method) continue;
    const names = []; const rx = new RegExp("^" + r.p.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    const m = rx.exec(url); if (!m) continue;
    const req = { userId, body, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])), isAdmin: staff, isAnalyst: false };
    const res = { statusCode: 200, body: null }; res.status = c => { res.statusCode = c; return res; }; res.json = b => { res.body = b; return res; };
    for (const fn of r.h) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) break; }
    return res;
  }
  throw new Error(`no route ${method} ${url}`);
}
const CRED = { clientId: "id", clientSecret: "SUPER-SECRET-VALUE", cloud: "us-1" };

console.log("Tier gate:");
{
  const r = await call("POST", "/api/security-vendors/connect/crowdstrike", { userId: "u3", body: CRED });
  ok(r.statusCode === 402 && r.body.code === "UPGRADE_REQUIRED", "free tier is blocked (402)");
  ok(db.data.securityVendorConnections.length === 0, "nothing stored for a blocked client");
}

console.log("\nConnect + first sync:");
let connId;
{
  const bad = await call("POST", "/api/security-vendors/connect/nope", { userId: "u1", body: CRED });
  ok(bad.statusCode === 400, "unknown vendor rejected");
  const miss = await call("POST", "/api/security-vendors/connect/crowdstrike", { userId: "u1", body: { clientId: "x" } });
  ok(miss.statusCode === 400, "missing fields rejected");
  const r = await call("POST", "/api/security-vendors/connect/crowdstrike", { userId: "u1", body: CRED });
  ok(r.statusCode === 200 && r.body.ok && r.body.firstSync.ok, "growth client connects; validation + first sync succeed");
  connId = r.body.id;
  const stored = db.data.securityVendorConnections[0];
  ok(stored.encryptedSecret && !JSON.stringify(stored.encryptedSecret).includes("SUPER-SECRET-VALUE"), "credential is encrypted at rest");
  const list = await call("GET", "/api/security-vendors", { userId: "u1" });
  ok(list.body.length === 1 && !JSON.stringify(list.body).includes("SUPER-SECRET") && !("encryptedSecret" in list.body[0]), "list never returns the credential");
  const nonGet = vendorCalls.filter(c => !c.startsWith("GET") && !/oauth2\/token|entities/.test(c));
  ok(nonGet.length === 0, "vendor saw only reads (GET, token, entities-read)");
  ok(db.data.vendorDetections.length === 2, "both detections recorded");
  const vulns = db.data.agentVulnerabilities;
  ok(vulns.length === 1 && vulns[0].agentId === "a1" && vulns[0].source === "vendor" && vulns[0].kind === "av-detection" && vulns[0].status === "open", "matched host (FQDN vs short, case-insens) becomes an open vendor vulnerability on the right endpoint");
  ok(!db.data.agentVulnerabilities.some(v => v.agentId === "a2"), "u2's agent with the same hostname as an UNMATCHED detection is not touched (owner-scoped matching)");
  ok(db.data.recommendations.length === 2, "a draft recommendation exists for each medium+ detection (incl. unmatched host)");
  ok(normHost("WIN-01.corp.local") === "win-01", "hostname normalization");
}

console.log("\nIsolation:");
{
  const g = await call("GET", `/api/security-vendors/${connId}`, { userId: "u2" });
  ok(g.statusCode === 404, "another client cannot read it");
  const s = await call("POST", `/api/security-vendors/${connId}/sync`, { userId: "u2" });
  ok(s.statusCode === 404, "another client cannot sync it");
  const d = await call("DELETE", `/api/security-vendors/${connId}`, { userId: "u2" });
  ok(d.statusCode === 404 && db.data.securityVendorConnections.length === 1, "another client cannot delete it");
  const l = await call("GET", "/api/security-vendors", { userId: "u2" });
  ok(l.body.length === 0, "another client's list is empty");
}

console.log("\nVendor findings are not auto-closed by the agent:");
{
  const agent = { id: "a1", ownerUserId: "u1", hostname: "win-01" };
  const r = syncAgentFindings(db, agent, { host: { hostname: "win-01" }, checks: [{ id: "av_threats", status: "pass" }], findings: [] });
  ok(r.resolved === 0 && db.data.agentVulnerabilities[0].status === "open", "a clean agent report (av_threats pass) does not resolve the vendor finding");
}

console.log("\nFailed poll changes nothing:");
{
  const before = JSON.stringify([db.data.vendorDetections, db.data.agentVulnerabilities]);
  vendorMode = "down";
  const conn = db.data.securityVendorConnections[0];
  const okAt = conn.lastSyncOkAt;
  const r1 = await syncConnection(db, conn);
  ok(!r1.ok && conn.consecutiveFailures === 1 && conn.status === "active" && conn.lastSyncOkAt === okAt, "one failure: recorded, still active, last-good time kept");
  await syncConnection(db, conn); await syncConnection(db, conn);
  ok(conn.status === "error" && conn.lastError, "three failures: status error with a message");
  ok(JSON.stringify([db.data.vendorDetections, db.data.agentVulnerabilities]) === before, "detections and vulnerabilities are untouched by failed polls");
  ok(new Date(conn.nextPollAt) > new Date(Date.now() + 15 * 60 * 1000), "backoff pushes the next poll out");
  const agent = db.data.agents[0];
  ok(avDetectionSourceFor(db, agent) === null && connectionIsHealthy(conn) === false, "an erroring connection is NOT a healthy source (endpoint stays unknown)");
}

console.log("\nRecovery, remediation, deletion:");
{
  vendorMode = "ok";
  const conn = db.data.securityVendorConnections[0];
  const r = await syncConnection(db, conn);
  ok(r.ok && conn.status === "active" && conn.consecutiveFailures === 0 && conn.lastError === null, "a good poll recovers the connection");
  ok(avDetectionSourceFor(db, db.data.agents[0])?.vendor === "crowdstrike", "healthy connection is reported as the endpoint's detection source");
  ok(db.data.recommendations.length === 2, "re-polling does not duplicate recommendations");
  ok(db.data.vendorDetections.length === 2, "re-polling does not duplicate detections");

  vendorMode = "remediated";
  await syncConnection(db, conn);
  ok(db.data.agentVulnerabilities[0].status === "resolved", "vendor marks it closed -> vulnerability resolved");
  vendorMode = "ok";
  await syncConnection(db, conn);
  ok(db.data.agentVulnerabilities[0].status === "open", "re-opened if the vendor shows it active again");

  vendorMode = "gone";
  await syncConnection(db, conn);
  ok(db.data.agentVulnerabilities[0].status === "resolved" && db.data.vendorDetections.every(d => d.status === "resolved"), "successful poll where an in-window detection has vanished resolves it");
  vendorMode = "ok";
}

console.log("\nRevoke / delete:");
{
  const conn = db.data.securityVendorConnections[0];
  const rv = await call("POST", `/api/security-vendors/${connId}/revoke`, { userId: "u1" });
  ok(rv.body.status === "revoked" && conn.encryptedSecret === null, "revoke drops the stored credential");
  const sy = await call("POST", `/api/security-vendors/${connId}/sync`, { userId: "u1" });
  ok(sy.statusCode === 403, "a revoked connection cannot sync");
  ok(avDetectionSourceFor(db, db.data.agents[0]) === null, "a revoked connection is not a detection source");
  const del = await call("DELETE", `/api/security-vendors/${connId}`, { userId: "u1" });
  ok(del.body.ok && db.data.securityVendorConnections.length === 0 && db.data.vendorDetections.length === 0
    && !db.data.agentVulnerabilities.some(v => v.source === "vendor"), "delete removes the connection, its detections and its mirrored vulnerabilities");
}

console.log("\nVendor with no open/closed state (ESET):");
{
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const res = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname === "/oauth/token") return res({ access_token: "et" });
    if (u.pathname === "/v1/detections") return res({ detections: [
      { uuid: "e1", displayName: "Trojan found", severityLevel: "SEVERITY_LEVEL_HIGH", occurTime: new Date().toISOString(), objectName: "C:/x.exe" },
      { uuid: "e2", displayName: "Adware", severityLevel: "SEVERITY_LEVEL_LOW", occurTime: new Date().toISOString() },
    ] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const vulnsBefore = db.data.agentVulnerabilities.length, recsBefore = db.data.recommendations.length;
  const r = await call("POST", "/api/security-vendors/connect/eset", { userId: "u1", body: { region: "eu", username: "api@example.com", password: "pw" } });
  ok(r.statusCode === 200 && r.body.firstSync.ok, "ESET connects and syncs");
  ok(db.data.agentVulnerabilities.length === vulnsBefore, "no endpoint vulnerability is opened (no hostname, no open/closed state from the vendor)");
  ok(db.data.recommendations.length === recsBefore + 1 && /did not tell us whether it was remediated/.test(db.data.recommendations.at(-1).detail), "one human-review recommendation for the HIGH detection, worded without claiming its state");
  const list = await call("GET", "/api/security-vendors", { userId: "u1" });
  ok(list.body[0].reviewCount === 2 && list.body[0].activeCount === 0, "both detections show as 'to review', none as open");
  const cat = await call("GET", "/api/security-vendors/catalog", { userId: "u1" });
  ok(["crowdstrike", "sentinelone", "msdefender", "sophos", "eset"].every(id => cat.body.some(v => v.id === id)) && !JSON.stringify(cat.body).includes("SUPER"), "catalog lists every pull vendor and no secrets");
  globalThis.fetch = prevFetch;
}

process.exit(fail ? 1 : 0);
