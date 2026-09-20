// findingTasks.test.mjs — run: node findingTasks.test.mjs
//
// Exercises the REAL registered routes in taskRoutes.js (not a reimplemented
// pure-function stand-in) via a minimal mock Express app that captures each
// route's middleware chain and runs it directly against fake req/res objects.
// This is the only way to test this file's logic honestly: the create/complete
// logic lives inside the route closures themselves, not in an exported
// function, and the repo has no supertest/route-test harness.

import { registerTaskRoutes, FINDING_SOURCE_TYPES } from "./taskRoutes.js";
import { makeTierGate } from "./tierGate.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

// ── Minimal mock Express app ────────────────────────────────────
function mockApp() {
  const routes = []; // [{ method, pattern: RegExp, keys: [names], handlers }]
  const register = (method) => (path, ...handlers) => {
    const keys = [];
    const pattern = new RegExp("^" + path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    routes.push({ method, pattern, keys, handlers });
  };
  return {
    get: register("GET"), post: register("POST"), patch: register("PATCH"), delete: register("DELETE"),
    async call(method, path, req) {
      const [pathOnly] = path.split("?");
      const route = routes.find(r => r.method === method && r.pattern.test(pathOnly));
      if (!route) throw new Error(`No route registered for ${method} ${path}`);
      const m = route.pattern.exec(pathOnly);
      req.params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
      const res = {
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
      };
      for (const h of route.handlers) {
        let calledNext = false;
        await h(req, res, () => { calledNext = true; });
        if (!calledNext) break; // a middleware sent a response and stopped the chain
      }
      return res;
    },
  };
}

const noopAuth = (req, res, next) => next();

// ── Fixture db ────────────────────────────────────────────────
function mkDb() {
  return {
    data: {
      users: [
        { id: "client-1", email: "c@example.com", tier: "growth" },
        { id: "client-free", email: "free@example.com", tier: "free" },
      ],
      assessments: [
        { id: "a1", userId: "client-1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
          data: { checklist: { mfa: "No" } } },
      ],
      tasks: [],
    },
    async write() { /* no-op — in-memory only */ },
  };
}

const app = mockApp();
const db = mkDb();
const gate = makeTierGate(db);
registerTaskRoutes(app, { db, requireAuth: noopAuth, requireAdmin: noopAuth, gate });

const reqAs = (userId, body = {}) => ({ userId, isAdmin: false, isAnalyst: false, body });

console.log("Creating a finding-based task (no controlId):");
{
  const res = await app.call("POST", "/api/tasks", reqAs("client-1", {
    title: "Patch CVE-2024-1234 (Apache)",
    detail: "Update Apache to the patched release.",
    priority: "critical",
    findingRef: { sourceType: "cve", sourceId: "CVE-2024-1234", facts: { severity: "CRITICAL", score: 9.8 } },
  }));
  ok(res.statusCode === 201, `created (status ${res.statusCode})`);
  ok(res.body.controlId == null, "no controlId on a finding-based task");
  ok(res.body.findingRef?.sourceType === "cve" && res.body.findingRef?.sourceId === "CVE-2024-1234", "findingRef stored");
  ok(res.body.projectedGain === null && res.body.scoreAtCreate === null,
     "projectedGain/scoreAtCreate are honestly null — no fabricated posture claim");
  ok(res.body.control === null, "publicTask() reports control: null rather than throwing");
  ok(db.data.tasks.length === 1, "task actually persisted");
}

console.log("\nValidation on finding-based tasks:");
{
  const badSource = await app.call("POST", "/api/tasks", reqAs("client-1", {
    title: "x", findingRef: { sourceType: "not-a-real-type", sourceId: "1" },
  }));
  ok(badSource.statusCode === 400, `unknown sourceType rejected (${badSource.statusCode})`);

  const noId = await app.call("POST", "/api/tasks", reqAs("client-1", {
    title: "x", findingRef: { sourceType: "cve" },
  }));
  ok(noId.statusCode === 400, `missing sourceId rejected (${noId.statusCode})`);

  const noTitle = await app.call("POST", "/api/tasks", reqAs("client-1", {
    findingRef: { sourceType: "cve", sourceId: "CVE-2024-9999" },
  }));
  ok(noTitle.statusCode === 400, `missing title rejected for a finding task (${noTitle.statusCode})`);

  const both = await app.call("POST", "/api/tasks", reqAs("client-1", {
    title: "x", controlId: "mfa", findingRef: { sourceType: "cve", sourceId: "CVE-2024-1" },
  }));
  ok(both.statusCode === 400, `controlId + findingRef together rejected (${both.statusCode})`);

  ok(FINDING_SOURCE_TYPES.includes("vendor-review") && FINDING_SOURCE_TYPES.includes("attack-surface")
     && FINDING_SOURCE_TYPES.includes("darkweb") && FINDING_SOURCE_TYPES.includes("email-security"),
     "all four Threats/Vendor Risk source types are real, exported values");
}

console.log("\nCompleting a finding-based task never touches the posture score:");
{
  const before = JSON.parse(JSON.stringify(db.data.assessments[0].data));
  const created = await app.call("POST", "/api/tasks", reqAs("client-1", {
    title: "Reassess vendor: Acme Payroll", priority: "high",
    findingRef: { sourceType: "vendor-review", sourceId: "vendor-1" },
  }));
  const res = await app.call("POST", `/api/tasks/${created.body.id}/complete`, reqAs("client-1", {}));
  ok(res.statusCode === 200, `completed (status ${res.statusCode})`);
  ok(res.body.posture === null, "posture comes back null, not a fabricated delta");
  ok(res.body.task.status === "done" && !!res.body.task.completedAt, "task marked done");
  ok(JSON.stringify(db.data.assessments[0].data) === JSON.stringify(before),
     "the assessment's checklist is byte-for-byte unchanged");
  ok(db.data.postureHistory === undefined || db.data.postureHistory.length === 0,
     "no posture-history snapshot was recorded for a finding task");
  ok(res.body.task.history.some(h => h.action === "completed" && /no posture-score effect/i.test(h.note)),
     "history entry says plainly that nothing scored");
}

console.log("\nA real checklist task still scores exactly as before (regression guard):");
{
  const created = await app.call("POST", "/api/tasks", reqAs("client-1", { controlId: "mfa", targetLabel: "Yes, required on all accounts" }));
  ok(created.statusCode === 201, `checklist task created (${created.statusCode})`);
  ok(created.body.controlId === "mfa" && created.body.findingRef == null, "controlId set, findingRef absent");
  ok(typeof created.body.projectedGain === "number", "a real control task still gets a projected gain");
  const res = await app.call("POST", `/api/tasks/${created.body.id}/complete`, reqAs("client-1", {}));
  ok(res.body.posture && typeof res.body.posture.delta === "number", "completing it still returns a real posture delta");
  ok(db.data.assessments[0].data.checklist.mfa === "Yes, required on all accounts", "checklist was actually updated");
}

console.log("\ngate.capability(\"remediationTasks\") still enforced (Growth+):");
{
  const res = await app.call("POST", "/api/tasks", reqAs("client-free", {
    title: "x", findingRef: { sourceType: "cve", sourceId: "CVE-2024-1" },
  }));
  ok(res.statusCode === 402, `Free tier blocked from creating any task, finding-based or not (${res.statusCode})`);
  ok(res.body.code === "UPGRADE_REQUIRED", "with the standard upgrade-required shape");
}

console.log(fail === 0 ? "\nFinding-based tasks verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
