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

// Fields DomainMonitoringCard.load() reads: data.domains (array) and
// data.suggested (App.jsx). An empty list is its own valid state — the card
// renders a hardcoded "no domain yet" message rather than driving off a
// per-domain .state field, since there's no single domain to describe once a
// client can have several.
console.log("Client card contract — no domains yet:");
let d = await j("GET","/api/client/domain",T.c1);
for (const f of ["domains","suggested","serviceConfigured"]) ok(f in d, `returns .${f}`);
ok(Array.isArray(d.domains) && d.domains.length===0, "domains is an empty array, not a single null record");

console.log("\nAfter submit — state 'awaiting_ownership':");
// POST returns one record's clientView directly (not wrapped in domains[]) —
// callers get back exactly the domain they just created.
d = await j("POST","/api/client/domain",T.c1,{domain:"acme.com"});
const domainId = d.id;
ok(!!domainId, "returns the new record's own id");
ok(d.state==="awaiting_ownership","state matches the card's tone map");
ok(d.instructions?.type==="TXT" && d.instructions?.host && d.instructions?.value && d.instructions?.help,
   "instructions has type/host/value/help — all four the card renders");
ok(d.nextStep==="verify_dns","nextStep drives the submit form visibility");

console.log("\nA second domain renders as its own row:");
const d2 = await j("POST","/api/client/domain",T.c1,{domain:"acme.co.uk"});
d = await j("GET","/api/client/domain",T.c1);
ok(d.domains.length===2, "DomainMonitoringCard renders one DomainRow per entry in domains[]");
ok(d.domains.every(row => "id" in row && "domain" in row && "state" in row && "monitored" in row),
   "every row carries the fields DomainRow reads (id/domain/state/monitored/...)");

console.log("\nVerify endpoint contract (per-domain, by id):");
d = await j("POST",`/api/client/domain/${domainId}/verify`,T.c1,{});
for (const f of ["verified","state","headline","detail","lastCheckedAt"]) ok(f in d, `returns .${f}`);
ok(d.verified===false, "unpublished TXT → verified:false (not an error)");

console.log("\nAdmin queue contract:");
d = await j("GET","/api/admin/domains",T.admin);
for (const f of ["domains","counts","serviceConfigured","dashboardUrl","note"]) ok(f in d, `returns .${f}`);
for (const f of ["readyToEnroll","awaitingHibp","awaitingClient","monitored"])
  ok(f in d.counts, `counts.${f} — rendered as a stat tile`);
const row = d.domains.find(r => r.id === domainId);
for (const f of ["id","userId","domain","companyName","email","ownership","hibpStatus","actionable","lastCheckError"])
  ok(f in row, `row.${f}`);

console.log("\nAdmin status values match the UI's badge map:");
ok(["pending","verified","failed"].includes(row.ownership), `ownership="${row.ownership}" is in the card's map`);
ok(["not_submitted","submitted","verified","rejected"].includes(row.hibpStatus), `hibpStatus="${row.hibpStatus}" is in the map`);

console.log("\nFull admin flow through the UI's buttons (targets one domain by id):");
await runInStore(PROD_STORE, async()=>{ const r=getClientDomain(db,"c1");
  r.ownership=OWNERSHIP.VERIFIED; r.ownershipVerifiedAt=new Date().toISOString(); await db.write(); });
d = await j("GET","/api/admin/domains",T.admin);
ok(d.domains.find(r=>r.id===domainId).actionable===true, "'Ready to enroll' badge shows");
d = await j("POST",`/api/admin/domains/${domainId}/hibp-status`,T.admin,{status:"submitted",note:"added to HIBP dashboard"});
ok(d.hibpStatus==="submitted", "'Mark submitted' button works");
d = await j("POST",`/api/admin/domains/${domainId}/hibp-status`,T.admin,{status:"verified"});
ok(d.hibpStatus==="verified", "'Mark verified — go live' works");
d = await j("GET","/api/client/domain",T.c1);
const flipped = d.domains.find(r=>r.id===domainId);
ok(flipped.monitored===true && flipped.state==="monitored", "that domain's card flips to ACTIVE");
const untouched = d.domains.find(r=>r.id===d2.id);
ok(untouched.monitored===false, "the other domain is unaffected by an admin action on this one");

srv.close();
console.log(fail?`\n${fail} CONTRACT MISMATCHES`:"\nUI/API contract verified");
process.exit(fail?1:0);
