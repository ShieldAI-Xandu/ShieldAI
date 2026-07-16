// sandbox.http.test.mjs — run: DB_DIR=./testdata JWT_SECRET=test node sandbox.http.test.mjs
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, PROD_STORE, DEMO_STORE, sandboxStats } from "../db.js";
import { isDemoRequest, demoSessionId, registerDemoRoutes, demoGuard, DEMO_PERSONAS } from "../demoGateway.js";
import { requireAuth } from "../auth.js";

await runInStore(PROD_STORE, async()=>{ db.data.users=[{id:"p1",email:"real@bigclient.com"}];
  db.data.assessments=[{id:"pa1",userId:"p1",data:"REAL CLIENT CONFIDENTIAL"}]; await db.write(); });
await runInStore(DEMO_STORE, async()=>{
  db.data.users=[
    {id:"d1",email:DEMO_PERSONAS.client.email,companyName:"Meridian Dental Group",isDemo:true},
    {id:"d2",email:DEMO_PERSONAS.analyst.email,isAnalyst:true,isDemo:true},
  ];
  db.data.assessments=[{id:"da1",userId:"d1",data:"demo seed"}]; await db.write(); });

const app=express(); app.use(express.json());
app.use(storeBinder(isDemoRequest, demoSessionId));
app.use((req,res,next)=> req.isDemo ? demoGuard(req,res,next) : next());
registerDemoRoutes(app, db);
app.get("/api/assessments", requireAuth, (req,res)=>res.json(db.data.assessments));
app.post("/api/assessments", requireAuth, async(req,res)=>{
  db.data.assessments.push({id:req.body.id,userId:req.userId}); await db.write(); res.json({ok:true}); });
app.post("/api/billing/checkout", requireAuth, (req,res)=>res.json({ok:true}));
app.post("/api/agents/enroll", requireAuth, (req,res)=>res.json({token:"REAL-ENROLL-TOKEN"}));
const srv=app.listen(4801);
const B="http://localhost:4801";
const j=async(m,p,t,b)=>{const r=await fetch(B+p,{method:m,headers:{...(t?{authorization:"Bearer "+t}:{}),
  "Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});
  return {s:r.status,b:await r.json().catch(()=>({})),store:r.headers.get("x-shieldai-store")};};
let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m);if(!c)fail++;};

console.log("Two visitors start demos:");
const s1 = await j("POST","/api/demo/session",null,{persona:"client"});
const s2 = await j("POST","/api/demo/session",null,{persona:"client"});
ok(s1.b.readOnly===false && s1.b.sandbox===true, "session reports writable sandbox");
ok(s1.b.sessionId && s2.b.sessionId && s1.b.sessionId!==s2.b.sessionId, "each visitor gets a distinct session id");
const A=s1.b.token, Bt=s2.b.token;

console.log("\nWrites now WORK (the whole point):");
let r = await j("POST","/api/assessments",A,{id:"A-wrote"});
ok(r.s===200, "visitor A can POST — no more 403");
ok(r.store==="demo-sandbox", "bound to a sandbox, not the template");

console.log("\nVisitor isolation over HTTP:");
r = await j("GET","/api/assessments",A);
ok(JSON.stringify(r.b).includes("A-wrote"), "A sees their own write");
r = await j("GET","/api/assessments",Bt);
ok(!JSON.stringify(r.b).includes("A-wrote"), "B CANNOT see A's write");
ok(JSON.stringify(r.b).includes("da1"), "B sees the seeded data");

console.log("\nProduction still walled off:");
const pTok = jwt.sign({userId:"p1",email:"real@bigclient.com"}, process.env.JWT_SECRET);
r = await j("GET","/api/assessments",A);
ok(!JSON.stringify(r.b).includes("REAL CLIENT CONFIDENTIAL"), "demo CANNOT see production data");
r = await j("GET","/api/assessments",pTok);
ok(r.store==="prod" && JSON.stringify(r.b).includes("REAL CLIENT"), "prod token → prod store");
ok(!JSON.stringify(r.b).includes("A-wrote"), "prod cannot see demo writes");

console.log("\nStill blocked (would touch the real world):");
r = await j("POST","/api/billing/checkout",A,{});
ok(r.s===403 && /Stripe/.test(r.b.error), "billing blocked with a real reason");
r = await j("POST","/api/agents/enroll",A,{});
ok(r.s===403 && /enrollment token/.test(r.b.error), "agent enrollment blocked");

console.log("\nSandbox hijack attempt:");
const forged = jwt.sign({userId:"d1",email:"x",store:"demo",sid:s1.b.sessionId}, "wrong-secret");
r = await j("GET","/api/assessments",forged);
ok(r.store==="prod", "token signed with wrong secret can't claim A's sandbox");
ok(r.s===401, "and fails auth entirely");

console.log("\nExit destroys the sandbox:");
const before = (await j("GET","/api/demo/status")).b.sandbox.active;
r = await j("POST","/api/demo/exit",A,{});
ok(r.b.destroyed===true, "exit reports the sandbox destroyed");
const after = (await j("GET","/api/demo/status")).b.sandbox.active;
ok(after < before, `sandbox count dropped ${before}→${after}`);
r = await j("GET","/api/assessments",A);
ok(!JSON.stringify(r.b).includes("A-wrote"), "re-using the token gives a FRESH sandbox — old work gone");

srv.close();
console.log(fail?`\n${fail} FAILED`:"\nAll HTTP sandbox tests passed");
process.exit(fail?1:0);
