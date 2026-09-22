// tierGate.test.mjs — run: node tierGate.test.mjs
//
// Covers the `clientOnly` option added to capability() and the standalone
// clientOnly() middleware — the shared replacement for frameworkAddonRoutes.js's
// old hand-rolled blockStaff() guard. Exercises the REAL middleware functions
// (not a reimplementation) via fake req/res/next, matching the existing
// house convention of testing exported logic directly without a route harness.

import { makeTierGate } from "./tierGate.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const mkDb = (users = []) => ({ data: { users, subscriptions: [] } });
const mkRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  return res;
};
async function run(mw, req) {
  const res = mkRes();
  let calledNext = false;
  await mw(req, res, () => { calledNext = true; });
  return { res, calledNext };
}

const FREE_CLIENT = { id: "c-free", tier: "free" };
const GROWTH_CLIENT = { id: "c-growth", tier: "growth" };
const db = mkDb([FREE_CLIENT, GROWTH_CLIENT]);
const gate = makeTierGate(db);

console.log("capability(cap) — unchanged for the 59 existing single-arg call sites:");
{
  const mw = gate.capability("complianceAccess");
  const admin = await run(mw, { userId: "staff-1", isAdmin: true, isAnalyst: false });
  ok(admin.calledNext === true, "admin still waved through with no clientOnly option (backward compat)");

  const analyst = await run(mw, { userId: "staff-2", isAdmin: false, isAnalyst: true });
  ok(analyst.calledNext === true, "analyst still waved through too");

  const growth = await run(mw, { userId: "c-growth", isAdmin: false, isAnalyst: false });
  ok(growth.calledNext === true, "a client whose tier has the capability passes");

  const free = await run(mw, { userId: "c-free", isAdmin: false, isAnalyst: false });
  ok(free.calledNext === false && free.res.statusCode === 402, "a client without it still gets the normal 402");
  ok(free.res.body.code === "UPGRADE_REQUIRED", "with the existing UPGRADE_REQUIRED shape, untouched");
}

console.log("\ncapability(cap, { clientOnly: true }) — the new option:");
{
  const mw = gate.capability("complianceAccess", { clientOnly: true });
  const admin = await run(mw, { userId: "staff-1", isAdmin: true, isAnalyst: false });
  ok(admin.calledNext === false, "admin is now BLOCKED, not waved through");
  ok(admin.res.statusCode === 403, `403, not 402 (got ${admin.res.statusCode}) — this isn't a plan limit, it's a role exclusion`);
  ok(admin.res.body.code === "CLIENT_ONLY", "distinct code from UPGRADE_REQUIRED/LIMIT_REACHED");

  const analyst = await run(mw, { userId: "staff-2", isAdmin: false, isAnalyst: true });
  ok(analyst.calledNext === false && analyst.res.statusCode === 403, "analyst blocked identically to admin");

  const growth = await run(mw, { userId: "c-growth", isAdmin: false, isAnalyst: false });
  ok(growth.calledNext === true, "a real client is completely unaffected by clientOnly");

  const free = await run(mw, { userId: "c-free", isAdmin: false, isAnalyst: false });
  ok(free.res.statusCode === 402 && free.res.body.code === "UPGRADE_REQUIRED",
     "a client without the capability still gets the normal tier 402 — clientOnly doesn't change THAT check");
}

console.log("\nclientOnly() — standalone, no capability/tier check at all:");
{
  const mw = gate.clientOnly();
  const admin = await run(mw, { userId: "staff-1", isAdmin: true, isAnalyst: false });
  ok(admin.calledNext === false && admin.res.statusCode === 403, "admin blocked");
  ok(admin.res.body.code === "CLIENT_ONLY", "same CLIENT_ONLY code as the capability() variant");

  const analyst = await run(mw, { userId: "staff-2", isAdmin: false, isAnalyst: true });
  ok(analyst.calledNext === false, "analyst blocked");

  // Deliberately a client on a tier with NO capabilities at all (free) —
  // clientOnly() must pass them through regardless, since it makes no
  // capability judgement whatsoever.
  const free = await run(mw, { userId: "c-free", isAdmin: false, isAnalyst: false });
  ok(free.calledNext === true, "any real client passes — no tier/capability check happens here");
}

console.log(fail === 0 ? "\ntierGate clientOnly verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
