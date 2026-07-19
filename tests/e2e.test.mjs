// e2e.test.mjs — run with: DB_DIR=./testdata JWT_SECRET=test node e2e.test.mjs
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, DEMO_STORE, PROD_STORE } from "../db.js";
import { isDemoRequest, registerDemoRoutes, demoReadOnly, DEMO_PERSONAS, assertStoreSeparation } from "../demoGateway.js";
import { requireAuth } from "../auth.js";

// Seed both stores the way the real app would
await runInStore(PROD_STORE, async () => {
  db.data.users=[{id:"p1",email:"real@bigclient.com",companyName:"Real Client Inc"}];
  db.data.assessments=[{id:"pa1",userId:"p1",data:{company:{name:"REAL CLIENT CONFIDENTIAL"}}}];
  await db.write();
});
await runInStore(DEMO_STORE, async () => {
  db.data.users=[
    {id:"d1",email:DEMO_PERSONAS.client.email,companyName:"ShieldAI Demo Workspace",isDemo:true},
    {id:"d2",email:DEMO_PERSONAS.analyst.email,isAnalyst:true,isDemo:true},
  ];
  db.data.assessments=[{id:"da1",userId:"d1",data:{company:{name:"Meridian Dental Group"}}}];
  await db.write();
});

const app = express();
app.use(express.json());
app.use(storeBinder(isDemoRequest));
app.use((req,res,next)=> req.isDemo ? demoReadOnly(req,res,next) : next());
app.use((req,res,next)=>{
  if (req.isDemo && (req.path.startsWith("/api/billing")||req.path.startsWith("/api/admin")))
    return res.status(403).json({error:"Not available in the demo sandbox."});
  next();
});
registerDemoRoutes(app, db);
// A real route, unmodified — proves demo reuses prod code paths safely
app.get("/api/assessments", requireAuth, (req,res)=> res.json(db.data.assessments));
app.post("/api/assessments", requireAuth, async (req,res)=>{
  db.data.assessments.push({id:"new",userId:req.userId}); await db.write(); res.json({ok:true});
});
app.get("/api/admin/users", requireAuth, (req,res)=> res.json(db.data.users));

const srv = app.listen(4599);
const B="http://localhost:4599";
let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m); if(!c)fail++;};
const j = async (p,o)=>{const r=await fetch(B+p,o); return {s:r.status, b:await r.json().catch(()=>({})), h:r.headers.get("x-shieldai-store")};};

console.log("Public demo entry:");
const st = await j("/api/demo/status");
ok(st.b.seeded===true && st.b.personas.length===2, "status reports seeded, 2 personas");
const sess = await j("/api/demo/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({persona:"client"})});
ok(sess.s===200 && !!sess.b.token, "session issued with NO credentials");
ok(sess.b.readOnly===true && sess.b.user.isDemo===true, "session flagged demo + read-only");
const dTok = sess.b.token;
const aSess = await j("/api/demo/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({persona:"analyst"})});
ok(aSess.b.user.isAnalyst===true, "analyst persona available");

console.log("\nData isolation over HTTP:");
const dData = await j("/api/assessments",{headers:{authorization:"Bearer "+dTok}});
ok(dData.h==="demo", "demo token routed to demo store");
ok(JSON.stringify(dData.b).includes("Meridian"), "demo sees demo data");
ok(!JSON.stringify(dData.b).includes("REAL CLIENT CONFIDENTIAL"), "demo CANNOT see production data");

const pTok = jwt.sign({userId:"p1",email:"real@bigclient.com"}, "prod-secret");
const pData = await j("/api/assessments",{headers:{authorization:"Bearer "+pTok}});
ok(pData.h==="prod", "prod token routed to prod store");
ok(JSON.stringify(pData.b).includes("REAL CLIENT CONFIDENTIAL"), "prod sees prod data");
ok(!JSON.stringify(pData.b).includes("Meridian"), "prod does NOT see demo data");

console.log("\nSandbox restrictions:");
const w = await j("/api/assessments",{method:"POST",headers:{authorization:"Bearer "+dTok,"Content-Type":"application/json"},body:"{}"});
ok(w.s===403 && w.b.code==="DEMO_READ_ONLY", "demo write blocked (403)");
const ad = await j("/api/admin/users",{headers:{authorization:"Bearer "+dTok}});
ok(ad.s===403, "demo blocked from /api/admin");
const bl = await j("/api/billing/checkout",{method:"POST",headers:{authorization:"Bearer "+dTok}});
ok(bl.s===403, "demo blocked from /api/billing");

// Confirm the demo write truly didn't land anywhere
await runInStore(DEMO_STORE, async()=>{ await db.read(); ok(db.data.assessments.length===1,"demo store unchanged after blocked write"); });
await runInStore(PROD_STORE, async()=>{ await db.read(); ok(db.data.assessments.length===1,"prod store unchanged after demo activity"); });

console.log("\nBoot guard:");
ok(assertStoreSeparation().ok===true, "clean stores pass separation check");
await runInStore(PROD_STORE, async()=>{ db.data.users.push({id:"x",email:DEMO_PERSONAS.client.email}); await db.write(); });
ok(assertStoreSeparation().ok===false, "leaked demo account in prod DETECTED");

srv.close();
console.log(fail?`\n${fail} FAILED`:"\nAll end-to-end tests passed");
process.exit(fail?1:0);
