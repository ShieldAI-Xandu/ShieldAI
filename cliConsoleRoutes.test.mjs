// cliConsoleRoutes.test.mjs — run: node cliConsoleRoutes.test.mjs
// Exercises the real route handler through a tiny fake app (house convention:
// no HTTP harness — see securityVendorRoutes.test.mjs), with a fake
// callClaudeWithTools standing in for the real Anthropic tool-use loop so
// these tests never hit the network.
//
// cliConsoleRoutes.js imports adminRoutes.js, which imports auth.js — auth.js
// throws at import time if JWT_SECRET is unset (by design, see its own
// comment), so this test-only value must be set before that import chain runs.
process.env.JWT_SECRET = "test-secret-not-for-production";

const { registerCliConsoleRoutes } = await import("./cliConsoleRoutes.js");

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

// ── fake app / db ──────────────────────────────────────────────────────
const db = { data: {
  users: [
    { id: "u1", email: "admin@corp.com", isAdmin: true, isAnalyst: false, tier: "growth", createdAt: "2026-01-01T00:00:00Z" },
    { id: "u2", email: "client@corp.com", isAdmin: false, isAnalyst: false, tier: "free", suspended: true, createdAt: "2026-01-02T00:00:00Z" },
  ],
  adminAudit: [
    { id: "aud1", actorUserId: "u1", actorEmail: "admin@corp.com", action: "suspend", targetUserId: "u2", detail: "Account suspended.", at: "2026-02-01T00:00:00Z" },
  ],
  subscriptions: [], agents: [], assessments: [], programs: [], policyDocs: [],
}, write: async () => {} };

const requireAdmin = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: "admin only" }));
const aiLimiter = (req, res, next) => next();

let lastToolCall = { tools: null, runTool: null };
async function fakeCallClaudeWithTools({ tools, runTool }) {
  lastToolCall = { tools, runTool };
  // Simulate Claude calling every read tool once, then answering.
  const results = {};
  for (const t of tools) results[t.name] = await runTool(t.name, t.name === "get_account" ? { idOrEmail: "u2" } : {});
  return `Simulated answer. list_accounts=${results.list_accounts.length} get_account=${results.get_account.email} audit=${results.list_audit.length} health_ok=${!!results.system_health.checkedAt}`;
}

const routes = [];
const reg = (m) => (p, ...h) => routes.push({ m, p, h });
const app = { get: reg("GET"), post: reg("POST") };
registerCliConsoleRoutes(app, { db, requireAdmin, callClaudeWithTools: fakeCallClaudeWithTools, aiLimiter });

async function call(method, url, { isAdmin = true, body = {} } = {}) {
  for (const r of routes) {
    if (r.m !== method) continue;
    const names = []; const rx = new RegExp("^" + r.p.replace(/:([a-zA-Z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
    const m = rx.exec(url); if (!m) continue;
    const req = { body, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])), isAdmin };
    const res = { statusCode: 200, body: null }; res.status = c => { res.statusCode = c; return res; }; res.json = b => { res.body = b; return res; };
    for (const fn of r.h) { let nexted = false; await fn(req, res, () => { nexted = true; }); if (!nexted) break; }
    return res;
  }
  throw new Error(`no route ${method} ${url}`);
}

console.log("Auth gate:");
{
  const r = await call("POST", "/api/admin/cli-console/ask", { isAdmin: false, body: { question: "hi" } });
  ok(r.statusCode === 403, "non-admin is rejected before reaching the handler");
}

console.log("\nAsk:");
{
  const missing = await call("POST", "/api/admin/cli-console/ask", { body: {} });
  ok(missing.statusCode === 400, "empty question rejected");

  const r = await call("POST", "/api/admin/cli-console/ask", { body: { question: "which accounts are suspended?" } });
  ok(r.statusCode === 200 && typeof r.body.answer === "string", "returns an answer string");
  ok(lastToolCall.tools.length === 4, "exactly 4 tools offered (list_accounts, get_account, list_audit, system_health)");
  ok(lastToolCall.tools.every(t => t.name.startsWith("list_") || t.name.startsWith("get_") || t.name === "system_health"), "only read-shaped tool names — no write tool exposed");
  ok(r.body.answer.includes("list_accounts=2"), "list_accounts tool returned both seeded users");
  ok(r.body.answer.includes("get_account=client@corp.com"), "get_account resolves by id");
  ok(r.body.answer.includes("audit=1"), "list_audit returned the seeded entry");
  ok(r.body.answer.includes("health_ok=true"), "system_health returned a checkedAt timestamp");
}

console.log("\nget_account by email + unknown lookups:");
{
  // Call runTool directly (already captured) to check the email-lookup path and the not-found case.
  const byEmail = await lastToolCall.runTool("get_account", { idOrEmail: "ADMIN@corp.com" });
  ok(byEmail.email === "admin@corp.com", "get_account resolves case-insensitively by email");
  const notFound = await lastToolCall.runTool("get_account", { idOrEmail: "nobody@nowhere.com" });
  ok(notFound.error, "unknown account returns a clean error, not a throw");
  const unknownTool = await lastToolCall.runTool("delete_account", {});
  ok(unknownTool.error === "Unknown tool: delete_account", "an unrecognized tool name is refused, never silently run");
}

console.log("\nUpstream failure handling:");
{
  const throwingApp = { get: reg("GET"), post: (p, ...h) => { throwingRoutes.push({ p, h }); } };
  const throwingRoutes = [];
  registerCliConsoleRoutes(throwingApp, {
    db, requireAdmin, aiLimiter,
    callClaudeWithTools: async () => { throw new Error("Anthropic API error 529: overloaded"); },
  });
  const req = { body: { question: "hi" }, params: {}, isAdmin: true };
  const res = { statusCode: 200, body: null }; res.status = c => { res.statusCode = c; return res; }; res.json = b => { res.body = b; return res; };
  for (const fn of throwingRoutes[0].h) await fn(req, res, () => {});
  ok(res.statusCode === 502 && !/Anthropic|overloaded/.test(JSON.stringify(res.body)), "a failed upstream call returns a clean 502, no internal error text leaked");
}

console.log(fail === 0 ? "\nAll passed." : `\n${fail} FAILED.`);
process.exit(fail === 0 ? 0 : 1);
