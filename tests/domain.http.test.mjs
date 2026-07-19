// domain.http.test.mjs — run: DB_DIR=./testdata JWT_SECRET=test HIBP_API_KEY=test node domain.http.test.mjs
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, PROD_STORE } from "../db.js";
import { isDemoRequest } from "../demoGateway.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { registerDomainRoutes } from "../domainRoutes.js";
import { registerCveRoutes } from "../cveRoutes.js";
import { analystOwnsClient } from "../assignmentRoutes.js";
import { OWNERSHIP, HIBP_STATUS, getClientDomain } from "../domainService.js";

await runInStore(PROD_STORE, async () => {
  db.data.users = [
    { id:"admin1", email:"dbrooks@xandultd.com", companyName:"Xandu", isAdmin:true },
    { id:"c1", email:"ceo@acme.com", companyName:"Acme Inc" },
    { id:"c2", email:"cfo@globex.com", companyName:"Globex" },
    { id:"an1", email:"analyst@xandultd.com", companyName:"Xandu", isAnalyst:true },
  ];
  db.data.clientDomains = [];
  db.data.assignments = [{ id:"a1", analystUserId:"an1", clientUserId:"c1" }];
  await db.write();
});

const app = express();
app.use(express.json());
app.use(storeBinder(isDemoRequest));
registerDomainRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient });
registerCveRoutes(app, { db, requireAuth, requireAdmin, analystOwnsClient });
const srv = app.listen(4711);

const tok = (id,email,extra={}) => jwt.sign({ userId:id, email, ...extra }, process.env.JWT_SECRET);
const T = { admin: tok("admin1","dbrooks@xandultd.com",{isAdmin:true}), c1: tok("c1","ceo@acme.com"),
            c2: tok("c2","cfo@globex.com"), an1: tok("an1","analyst@xandultd.com",{isAnalyst:true}) };
const j = async (m,p,t,b) => { const r = await fetch("http://localhost:4711"+p, {
  method:m, headers:{ authorization:"Bearer "+t, "Content-Type":"application/json" },
  body: b?JSON.stringify(b):undefined }); return { s:r.status, b: await r.json().catch(()=>({})) }; };

let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m); if(!c)fail++;};

console.log("Client submits a domain:");
let r = await j("GET","/api/client/domain",T.c1);
ok(r.b.state==="none" && r.b.monitored===false, "no domain yet → 'none', not monitored");
ok(r.b.suggested==="acme.com", "suggests acme.com from email as a pre-fill hint");

r = await j("POST","/api/client/domain",T.c1,{domain:"https://www.acme.com/pricing"});
ok(r.s===200 && r.b.domain==="acme.com", "accepts and normalizes");
ok(r.b.monitored===false, "not monitored on submit");
ok(r.b.instructions?.type==="TXT", "returns TXT instructions");
ok(r.b.instructions?.value?.startsWith("shieldai-domain-verification="), "instruction has the token");

console.log("\nPublic email domain refused:");
r = await j("POST","/api/client/domain",T.c2,{domain:"gmail.com"});
ok(r.s===400 && /public email provider/.test(r.b.error), "gmail.com rejected over HTTP");

console.log("\nCross-client isolation:");
r = await j("GET","/api/client/domain?userId=c1",T.c2);
ok(r.s===403, "client CANNOT read another client's domain");
r = await j("GET","/api/client/domain?userId=c1",T.an1);
ok(r.s===200, "assigned analyst CAN read their client's domain");
r = await j("GET","/api/client/domain?userId=c2",T.an1);
ok(r.s===403, "analyst CANNOT read an unassigned client's domain");

console.log("\nAdmin queue:");
r = await j("GET","/api/admin/domains",T.admin);
ok(r.s===200 && r.b.counts.total===1, "queue lists the domain");
ok(r.b.counts.awaitingClient===1, "counts it as awaiting the client");
ok(r.b.dashboardUrl?.includes("haveibeenpwned.com/DomainSearch"), "points admin at the real dashboard");
r = await j("GET","/api/admin/domains",T.c1);
ok(r.s===403, "non-admin blocked from the queue");

console.log("\nGATE: admin cannot mark monitoring live before ownership:");
r = await j("POST","/api/admin/domains/c1/hibp-status",T.admin,{status:"verified"});
ok(r.s===409 && /hasn't proved domain ownership/.test(r.b.error), "409 — refuses over HTTP");

console.log("\nAfter ownership passes (simulated):");
await runInStore(PROD_STORE, async () => {
  const rec = getClientDomain(db,"c1");
  rec.ownership = OWNERSHIP.VERIFIED; rec.ownershipVerifiedAt = new Date().toISOString();
  await db.write();
});
r = await j("GET","/api/admin/domains",T.admin);
ok(r.b.counts.readyToEnroll===1 && r.b.domains[0].actionable===true, "now flagged ready to enroll");
r = await j("POST","/api/admin/domains/c1/hibp-status",T.admin,{status:"submitted",note:"added to dashboard"});
ok(r.s===200 && r.b.hibpStatus==="submitted", "admin records 'submitted'");
r = await j("GET","/api/client/domain",T.c1);
ok(r.b.monitored===false && r.b.state==="awaiting_hibp", "client sees 'setup in progress' — NOT monitored");
r = await j("POST","/api/admin/domains/c1/hibp-status",T.admin,{status:"verified"});
ok(r.s===200, "admin marks verified once ownership proved");
r = await j("GET","/api/client/domain",T.c1);
ok(r.b.monitored===true && r.b.state==="monitored", "client now sees monitoring active");

console.log("\nAudit trail:");
await runInStore(PROD_STORE, async () => {
  const a = (db.data.adminAudit||[]).filter(x=>x.action?.startsWith("domain_hibp"));
  ok(a.length>=2, `logged ${a.length} admin status changes`);
  ok(a.every(x=>x.actorEmail==="dbrooks@xandultd.com"), "audit records the actor");
});

srv.close();
console.log(fail?`\n${fail} FAILED`:"\nAll HTTP workflow tests passed");
process.exit(fail?1:0);
