// sandbox.test.mjs — run: DB_DIR=./testdata node sandbox.test.mjs
import db, { runInStore, runInSandbox, destroySandbox, sandboxStats,
  getStore, PROD_STORE, DEMO_STORE, sweepSandboxes } from "../db.js";

let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m);if(!c)fail++;};

// Seed prod + demo template
await runInStore(PROD_STORE, async()=>{ db.data.users=[{id:"p1",email:"real@client.com"}]; await db.write(); });
await runInStore(DEMO_STORE, async()=>{
  db.data.users=[{id:"d1",email:"demo-client@shieldai.demo",companyName:"Meridian Dental Group"}];
  db.data.assessments=[{id:"seed1",userId:"d1",data:{company:{name:"Meridian"}}}];
  await db.write();
});

console.log("Per-visitor sandbox isolation:");
await runInSandbox("visitor-A", async()=>{
  db.data.assessments.push({id:"A-created",userId:"d1"});
  db.data.users.push({id:"A-user",email:"a@a.com"});
  await db.write();
});
await runInSandbox("visitor-B", async()=>{
  const ids = db.data.assessments.map(a=>a.id);
  ok(!ids.includes("A-created"), "visitor B CANNOT see visitor A's writes");
  ok(ids.includes("seed1"), "visitor B sees the seeded template data");
  ok(!db.data.users.some(u=>u.id==="A-user"), "visitor B cannot see A's created user");
  db.data.assessments.push({id:"B-created",userId:"d1"});
  await db.write();
});
await runInSandbox("visitor-A", async()=>{
  const ids = db.data.assessments.map(a=>a.id);
  ok(ids.includes("A-created"), "visitor A's writes PERSIST across requests");
  ok(!ids.includes("B-created"), "visitor A cannot see visitor B's writes");
});

console.log("\nTemplate protection:");
await runInStore(DEMO_STORE, async()=>{
  await db.read();
  const ids = db.data.assessments.map(a=>a.id);
  ok(ids.length===1 && ids[0]==="seed1", "the seeded TEMPLATE is unpolluted by any visitor");
});

console.log("\nProduction protection:");
await runInStore(PROD_STORE, async()=>{
  await db.read();
  ok(db.data.users.length===1 && db.data.users[0].email==="real@client.com", "production untouched by demo writes");
  ok(!db.data.assessments?.some?.(a=>a.id?.startsWith("A-")||a.id?.startsWith("B-")), "no demo data leaked to prod");
});

console.log("\nDeep-clone integrity (nested mutation must not touch template):");
await runInSandbox("visitor-C", async()=>{
  db.data.assessments[0].data.company.name = "MUTATED BY C";
  await db.write();
});
await runInStore(DEMO_STORE, async()=>{
  ok(db.data.assessments[0].data.company.name==="Meridian", "nested template object NOT mutated (structuredClone works)");
});

console.log("\nDiscard on exit:");
ok(sandboxStats().active===3, `3 sandboxes active (${sandboxStats().active})`);
ok(destroySandbox("visitor-A")===true, "destroySandbox returns true");
ok(sandboxStats().active===2, "sandbox count drops");
await runInSandbox("visitor-A", async()=>{
  ok(!db.data.assessments.some(a=>a.id==="A-created"), "re-entering after exit gives a FRESH sandbox — old data gone");
});

console.log("\nConcurrency (interleaved async in different sandboxes):");
const res = await Promise.all([
  runInSandbox("cc-1", async()=>{ db.data.assessments.push({id:"cc1"}); await new Promise(r=>setTimeout(r,25)); return db.data.assessments.map(a=>a.id); }),
  runInSandbox("cc-2", async()=>{ db.data.assessments.push({id:"cc2"}); await new Promise(r=>setTimeout(r,10)); return db.data.assessments.map(a=>a.id); }),
  runInStore(PROD_STORE, async()=>{ await new Promise(r=>setTimeout(r,15)); return db.data.users.map(u=>u.email); }),
]);
ok(res[0].includes("cc1") && !res[0].includes("cc2"), "concurrent sandbox 1 isolated");
ok(res[1].includes("cc2") && !res[1].includes("cc1"), "concurrent sandbox 2 isolated");
ok(res[2][0]==="real@client.com", "concurrent prod request unaffected");

console.log(fail?`\n${fail} FAILED`:"\nAll sandbox isolation tests passed");
process.exit(fail?1:0);
