// domain.contract.test.mjs — run: DB_DIR=./testdata JWT_SECRET=test HIBP_API_KEY=test node domain.contract.test.mjs
// Verifies the UI's assumptions match what the API actually returns.
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, PROD_STORE } from "../db.js";
import { isDemoRequest } from "../demoGateway.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { registerDomainRoutes } from "../domainRoutes.js";
import { analystOwnsClient } from "../assignmentRoutes.js";
import { OWNERSHIP, HIBP_STATUS, getClientDomain } from "../domainService.js";

await runInStore(PROD_STORE, async () => {
  db.data.users = [
    { id:"admin1", email:"dbrooks@xandultd.com", companyName:"Xandu", isAdmin:true },
    { id:"c1", email:"ceo@acme.com", companyName:"Acme Inc" },
  ];
  db.data.clientDomains = []; db.data.assignments = []; db.data.adminAudit = [];
  await db.write();
});
const app = express(); app.use(express.json()); app.use(storeBinder(isDemoRequest));
registerDomainRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient });
const srv = app.listen(4712);
const T = { admin: jwt.sign({userId:"admin1",email:"dbrooks@xandultd.com",isAdmin:true}, process.env.JWT_SECRET),
            c1: jwt.sign({userId:"c1",email:"ceo@acme.com"}, process.env.JWT_SECRET) };
const j = async (m,p,t,b)=>{const r=await fetch("http://localhost:4712"+p,{method:m,
  headers:{authorization:"Bearer "+t,"Content-Type":"application/json"},body:b?JSON.stringify(b):undefined});
  return await r.json();};
let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m);if(!c)fail++;};

// Fields the client card reads
console.log("Client card contract — state 'none':");
let d = await j("GET","/api/client/domain",T.c1);
for (const f of ["state","headline","detail","monitored","nextStep","suggested","serviceConfigured"])
  ok(f in d, `returns .${f}`);
ok(d.state==="none", "state=none maps to the '＋' tone in the card");

console.log("\nAfter submit — state 'awaiting_ownership':");
d = await j("POST","/api/client/domain",T.c1,{domain:"acme.com"});
ok(d.state==="awaiting_ownership","state matches the card's tone map");
ok(d.instructions?.type==="TXT" && d.instructions?.host && d.instructions?.value && d.instructions?.help,
   "instructions has type/host/value/help — all four the card renders");
ok(d.nextStep==="verify_dns","nextStep drives the submit form visibility");

console.log("\nVerify endpoint contract:");
d = await j("POST","/api/client/domain/verify",T.c1,{});
for (const f of ["verified","state","headline","detail","lastCheckedAt"]) ok(f in d, `returns .${f}`);
ok(d.verified===false, "unpublished TXT → verified:false (not an error)");

console.log("\nAdmin queue contract:");
d = await j("GET","/api/admin/domains",T.admin);
for (const f of ["domains","counts","serviceConfigured","dashboardUrl","note"]) ok(f in d, `returns .${f}`);
for (const f of ["readyToEnroll","awaitingHibp","awaitingClient","monitored"])
  ok(f in d.counts, `counts.${f} — rendered as a stat tile`);
const row = d.domains[0];
for (const f of ["id","userId","domain","companyName","email","ownership","hibpStatus","actionable","lastCheckError"])
  ok(f in row, `row.${f}`);

console.log("\nAdmin status values match the UI's badge map:");
ok(["pending","verified","failed"].includes(row.ownership), `ownership="${row.ownership}" is in the card's map`);
ok(["not_submitted","submitted","verified","rejected"].includes(row.hibpStatus), `hibpStatus="${row.hibpStatus}" is in the map`);

console.log("\nFull admin flow through the UI's buttons:");
await runInStore(PROD_STORE, async()=>{ const r=getClientDomain(db,"c1");
  r.ownership=OWNERSHIP.VERIFIED; r.ownershipVerifiedAt=new Date().toISOString(); await db.write(); });
d = await j("GET","/api/admin/domains",T.admin);
ok(d.domains[0].actionable===true, "'Ready to enroll' badge shows");
d = await j("POST","/api/admin/domains/c1/hibp-status",T.admin,{status:"submitted",note:"added to HIBP dashboard"});
ok(d.hibpStatus==="submitted", "'Mark submitted' button works");
d = await j("POST","/api/admin/domains/c1/hibp-status",T.admin,{status:"verified"});
ok(d.hibpStatus==="verified", "'Mark verified — go live' works");
d = await j("GET","/api/client/domain",T.c1);
ok(d.monitored===true && d.state==="monitored", "client card flips to ACTIVE");

srv.close();
console.log(fail?`\n${fail} CONTRACT MISMATCHES`:"\nUI/API contract verified");
process.exit(fail?1:0);
