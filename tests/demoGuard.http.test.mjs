// demoGuard.http.test.mjs — run: DB_DIR=./testdata JWT_SECRET=test node demoGuard.http.test.mjs
//
// Replaces the old e2e.test.mjs, which imported a `demoReadOnly` export that
// no longer exists — it tested a blanket "demo is read-only" policy from
// before the per-visitor sandbox model shipped (writes are now allowed but
// isolated; see sandbox.test.mjs / sandbox.http.test.mjs, which already cover
// that architecture end-to-end, including the real dual prod+demo store
// setup this file used to duplicate).
//
// What's actually left untested elsewhere: demoGateway.js's
// DEMO_BLOCKED_PREFIXES list — the specific set of routes a demo session is
// refused even though its sandbox can otherwise do anything a real account
// can. In particular the "/api/admin" blanket block carries an `except` list
// (agentRoutes.js mounts genuinely client-facing routes under /api/admin —
// a legacy URL choice, not a permission boundary) and a MORE SPECIFIC block
// (enroll-token minting) that must win even though its own path falls inside
// the carved-out prefix. That precedence is exactly the kind of thing that
// silently breaks in a one-line edit, so it gets its own coverage here,
// against the real demoGuard + registerDemoRoutes (not a test-local stand-in).
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, PROD_STORE, DEMO_STORE } from "../db.js";
import { isDemoRequest, demoSessionId, registerDemoRoutes, demoGuard, DEMO_PERSONAS } from "../demoGateway.js";
import { requireAuth } from "../auth.js";

await runInStore(PROD_STORE, async () => {
  db.data.users = [{ id:"p1", email:"real@bigclient.com", isAdmin:true }];
  await db.write();
});
await runInStore(DEMO_STORE, async () => {
  db.data.users = [{ id:"d1", email:DEMO_PERSONAS.client.email, isDemo:true }];
  await db.write();
});

const app = express();
app.use(express.json());
app.use(storeBinder(isDemoRequest, demoSessionId));
app.use((req,res,next)=> req.isDemo ? demoGuard(req,res,next) : next());
registerDemoRoutes(app, db, { redeemLimiter: (req,res,next)=>next() });

const ok200 = (req,res) => res.json({ ok:true, path:req.path });
app.get("/api/admin/users", requireAuth, ok200);
app.get("/api/admin/endpoints", requireAuth, ok200);           // carve-out: client-facing despite the prefix
app.post("/api/admin/recommendations", requireAuth, ok200);    // carve-out
app.post("/api/admin/endpoints/enroll-token", requireAuth, ok200); // more specific block wins over the carve-out
app.post("/api/billing/checkout", requireAuth, ok200);
app.post("/api/agent/enroll", requireAuth, ok200);

const srv = app.listen(4599);
const B = "http://localhost:4599";
let fail = 0; const ok = (c,m) => { console.log((c?"  ✔ ":"  ✖ ")+m); if (!c) fail++; };
const call = async (m,p,t) => { const r = await fetch(B+p, { method:m, headers:{ authorization:"Bearer "+t } });
  return { s:r.status, b: await r.json().catch(()=>({})) }; };

console.log("Get a real demo session (not a hand-signed token — proves registerDemoRoutes is really mounted):");
const sess = await fetch(B+"/api/demo/session", { method:"POST", headers:{"Content-Type":"application/json"},
  body: JSON.stringify({ persona:"client" }) }).then(r=>r.json());
ok(!!sess.token && sess.user.isDemo===true, "session issued");
const demoTok = sess.token;
const prodTok = jwt.sign({ userId:"p1", email:"real@bigclient.com", isAdmin:true }, process.env.JWT_SECRET);

console.log("\nBlocked for a demo session (touches the real world):");
let r = await call("GET","/api/admin/users",demoTok);
ok(r.s===403, "/api/admin/* blanket block: /api/admin/users refused");
r = await call("POST","/api/billing/checkout",demoTok);
ok(r.s===403, "/api/billing/* refused — would create a real Stripe charge");
r = await call("POST","/api/agent/enroll",demoTok);
ok(r.s===403, "/api/agent/enroll refused — would mint a real enrollment token");
r = await call("POST","/api/admin/endpoints/enroll-token",demoTok);
ok(r.s===403, "the MORE SPECIFIC enroll-token block wins even though its path falls inside the /api/admin/endpoints carve-out");

console.log("\nCarved back out of the blanket /api/admin block (genuinely client-facing routes):");
r = await call("GET","/api/admin/endpoints",demoTok);
ok(r.s===200, "/api/admin/endpoints is reachable in the demo (an investor's tour includes 'my endpoints')");
r = await call("POST","/api/admin/recommendations",demoTok);
ok(r.s===200, "/api/admin/recommendations is reachable in the demo");

console.log("\nThe same routes are NOT blocked for a real (non-demo) session:");
r = await call("GET","/api/admin/users",prodTok);
ok(r.s===200, "a real admin reaches /api/admin/users fine — the block only ever applies to req.isDemo");
r = await call("POST","/api/billing/checkout",prodTok);
ok(r.s===200, "and /api/billing/* too");
r = await call("POST","/api/agent/enroll",prodTok);
ok(r.s===200, "and /api/agent/enroll too");

srv.close();
console.log(fail?`\n${fail} FAILED`:"\nAll demoGuard prefix-block tests passed");
process.exit(fail?1:0);
