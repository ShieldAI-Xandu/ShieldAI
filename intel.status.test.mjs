// intel.status.test.mjs — run: DB_DIR=./testdata JWT_SECRET=test NVD_API_KEY=x HIBP_API_KEY=y node intel.status.test.mjs
import express from "express";
import jwt from "jsonwebtoken";
import db, { storeBinder, runInStore, PROD_STORE } from "../db.js";
import { isDemoRequest } from "../demoGateway.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { registerCveRoutes } from "../cveRoutes.js";
import { analystOwnsClient } from "../assignmentRoutes.js";

await runInStore(PROD_STORE, async () => {
  db.data.users=[{id:"admin1",email:"dbrooks@xandultd.com",isAdmin:true}];
  db.data.clientDomains=[
    {id:"d1",userId:"c1",domain:"acme.com",ownership:"verified",hibpStatus:"verified"},
    {id:"d2",userId:"c2",domain:"globex.com",ownership:"pending",hibpStatus:"not_submitted"},
  ];
  await db.write();
});
const app=express(); app.use(express.json()); app.use(storeBinder(isDemoRequest));
registerCveRoutes(app,{db,requireAuth,requireAdmin,analystOwnsClient});
const srv=app.listen(4714);
const A=jwt.sign({userId:"admin1",email:"dbrooks@xandultd.com",isAdmin:true},process.env.JWT_SECRET);
const g=async(p)=>{const r=await fetch("http://localhost:4714"+p,{headers:{authorization:"Bearer "+A}});return await r.json();};
let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m);if(!c)fail++;};

const d = await g("/api/admin/threat-intel/status");
console.log(`Keys present: NVD=${!!process.env.NVD_API_KEY} HIBP=${!!process.env.HIBP_API_KEY}`);

console.log("\nEvery field the UI renders:");
for (const svc of d.services) {
  for (const f of ["id","name","purpose","configured","required","envVar","keyUrl",
                   "minIntervalMs","impact","degradesTo","cacheEntries","cacheTtlHours"])
    ok(f in svc, `${svc.id}.${f}`);
}
const nvd=d.services.find(x=>x.id==="nvd"), hibp=d.services.find(x=>x.id==="hibp");
ok("worstCaseRefreshSec" in nvd, "nvd.worstCaseRefreshSec (the 'Full refresh' tile)");
ok("domainsMonitored" in hibp && "domainsRegistered" in hibp, "hibp domain counts (the 'Domains live' tile)");
ok(hibp.domainsMonitored===1 && hibp.domainsRegistered===2, `counts correct: ${hibp.domainsMonitored}/${hibp.domainsRegistered}`);

console.log("\nWith both keys set:");
ok(nvd.configured===true, "NVD reports configured");
ok(hibp.configured===true, "HIBP reports configured");
ok(d.summary.operational===true, "summary: operational");
ok(d.summary.blockers.length===0, "no blockers");
ok(d.summary.advisories.length===0, "no advisories → UI shows the green 'all configured' line");
ok(nvd.minIntervalMs===700, "NVD rate limit drops to 700ms with a key");
ok(nvd.worstCaseRefreshSec < 10, `full refresh now ~${nvd.worstCaseRefreshSec}s (was ~78s)`);

srv.close();
console.log(fail?`\n${fail} FAILED`:"\nIntel status UI contract verified");
process.exit(fail?1:0);
