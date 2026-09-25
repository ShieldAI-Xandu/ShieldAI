// bitdefenderPush.test.mjs — run: node bitdefenderPush.test.mjs
// Bitdefender GravityZone push (JSON-RPC addEvents) through the real webhook
// route + adapter + shared endpoint-matching sink. Payload shape follows
// Bitdefender's public docs, NOT a live tenant.
import { normalizeIncomingFindings } from "./integrationAdapters.js";
import { registerIntegrationRoutes } from "./integrationRoutes.js";
import { makeTierGate } from "./tierGate.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const ev = (over = {}) => ({
  companyId: "c", computer_name: "FC-WIN7-X64-01", computer_fqdn: "fc-win7-x64-01.corp.local", computer_ip: "10.0.0.5", computer_id: "id1",
  product_installed: "BEST", malware_type: "file", malware_name: "EICAR-Test-File (not a virus)", file_path: "C:/eicar.txt",
  hash: "abc", final_status: "deleted", timestamp: "2026-09-25T12:00:00.000Z", module: "av", ...over,
});
const push = (...events) => ({ jsonrpc: "2.0", method: "addEvents", params: { events }, id: 1 });

console.log("Adapter:");
{
  const n = normalizeIncomingFindings("bitdefender", push(ev()));
  ok(n.length === 1 && n[0].status === "remediated" && n[0].severity === "medium" && n[0].host === "fc-win7-x64-01.corp.local", "deleted AV hit -> remediated / medium / FQDN host");
  ok(/EICAR/.test(n[0].title) && n[0].category === "malware", "title carries the malware name");
  const open = normalizeIncomingFindings("bitdefender", push(ev({ final_status: "ignored" })));
  ok(open[0].status === "active" && open[0].severity === "high", "ignored -> active / high");
  const unk = normalizeIncomingFindings("bitdefender", push(ev({ final_status: "wibble" })));
  ok(unk[0].status === "unknown", "unrecognized final_status -> unknown (never assumed remediated)");
  const fw = normalizeIncomingFindings("bitdefender", push(ev({ module: "fw" }), ev({ module: "registration" })));
  ok(Array.isArray(fw) && fw.length === 0, "non-detection modules (firewall, registration) are ignored");
  const notMine = normalizeIncomingFindings("bitdefender", { findings: [{ title: "generic" }] });
  ok(notMine.length === 1 && notMine[0].title === "generic", "non-addEvents payload falls back to the generic shape");
  const a = normalizeIncomingFindings("bitdefender", push(ev({ final_status: "ignored", timestamp: "2026-09-25T12:00:00Z" })))[0];
  const b = normalizeIncomingFindings("bitdefender", push(ev({ final_status: "deleted", timestamp: "2026-09-25T12:05:00Z" })))[0];
  ok(a.externalId === b.externalId, "same threat on same machine keeps ONE identity across later status changes");
  const avc = normalizeIncomingFindings("bitdefender", push(ev({ module: "avc", final_status: "blocked" })));
  ok(avc.length === 1 && avc[0].severity === "high", "Advanced Threat Control detection is high even when blocked");
}

console.log("\nWebhook route + endpoint matching:");
const db = { data: {
  users: [{ id: "u1", tier: "growth", companyName: "One" }, { id: "u2", tier: "growth" }],
  agents: [{ id: "a1", ownerUserId: "u1", hostname: "FC-WIN7-X64-01", status: "active" }, { id: "a2", ownerUserId: "u2", hostname: "FC-WIN7-X64-01", status: "active" }],
}, write: async () => {} };
const gate = makeTierGate(db);
const routes = [];
const reg = (m) => (p, ...h) => routes.push({ m, p, h });
registerIntegrationRoutes({ get: reg("GET"), post: reg("POST"), delete: reg("DELETE") }, { db, requireAuth: (r, s, n) => n(), gate, callClaudeText: null, extractJson: null });
async function call(method, url, { userId, body = {}, headers = {} } = {}) {
  for (const r of routes) {
    if (r.m !== method) continue;
    const names = []; const rx = new RegExp("^" + r.p.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    const m = rx.exec(url); if (!m) continue;
    const req = { userId, body, headers, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])), isAdmin: false, isAnalyst: false };
    const res = { statusCode: 200, body: null }; res.status = c => { res.statusCode = c; return res; }; res.json = b => { res.body = b; return res; };
    for (const fn of r.h) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) break; }
    return res;
  }
  throw new Error(`no route ${method} ${url}`);
}
{
  const created = await call("POST", "/api/integrations", { userId: "u1", body: { name: "Bitdefender", provider: "bitdefender" } });
  const { id, token } = created.body;
  const auth = { authorization: `Bearer ${token}` };

  const bad = await call("POST", `/api/integrations/webhook/${id}`, { body: push(ev()), headers: { authorization: "Bearer nope" } });
  ok(bad.statusCode === 401, "wrong token rejected");

  const r1 = await call("POST", `/api/integrations/webhook/${id}`, { body: push(ev({ final_status: "ignored" })), headers: auth });
  ok(r1.statusCode === 200 && r1.body.stored === 1, "push accepted and stored");
  const vulns = db.data.agentVulnerabilities || [];
  ok(vulns.length === 1 && vulns[0].agentId === "a1" && vulns[0].source === "vendor" && vulns[0].status === "open", "matched (FQDN vs short host) to the OWNER's endpoint as an open vendor vulnerability");
  ok(!vulns.some(v => v.agentId === "a2"), "another client's endpoint with the same hostname is not touched");
  ok(db.data.recommendations.length === 1, "one draft recommendation (from the existing integrations path, not duplicated)");

  const r2 = await call("POST", `/api/integrations/webhook/${id}`, { body: push(ev({ final_status: "deleted", timestamp: "2026-09-25T12:10:00Z" })), headers: auth });
  ok(r2.statusCode === 200 && db.data.agentVulnerabilities[0].status === "resolved", "a later 'deleted' event for the same threat resolves the vulnerability");

  const r3 = await call("POST", `/api/integrations/webhook/${id}`, { body: push(ev({ module: "fw" })), headers: auth });
  ok(r3.statusCode === 200 && r3.body.received === 0, "an events-only-of-other-modules push is accepted with nothing stored (200, so Bitdefender does not retry)");

  const del = await call("DELETE", `/api/integrations/${id}`, { userId: "u1" });
  ok(del.body.ok && !(db.data.agentVulnerabilities || []).some(v => v.source === "vendor") && (db.data.vendorDetections || []).length === 0, "deleting the integration removes its mirrored detections and vulnerabilities");
}

process.exit(fail ? 1 : 0);
