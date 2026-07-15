// isolation.test.mjs — run with: DB_DIR=./testdata JWT_SECRET=test node isolation.test.mjs
process.env.JWT_SECRET = "prod-secret";
import db, { runInStore, DEMO_STORE, PROD_STORE, getStore } from "../db.js";
import { signDemoToken, verifyDemoToken, isDemoRequest } from "../demoGateway.js";
import jwt from "jsonwebtoken";

let fail = 0;
const ok = (c,m) => { console.log((c?"  ✔ ":"  ✖ ")+m); if(!c) fail++; };

// Seed each store differently
await runInStore(PROD_STORE, async () => {
  db.data.users = [{ id:"p1", email:"real@client.com" }];
  await db.write();
});
await runInStore(DEMO_STORE, async () => {
  db.data.users = [{ id:"d1", email:"demo-client@shieldai.demo", isDemo:true }];
  await db.write();
});

console.log("Store isolation:");
await runInStore(PROD_STORE, () => {
  ok(db.data.users.every(u=>u.email==="real@client.com"), "prod context sees only prod users");
});
await runInStore(DEMO_STORE, () => {
  ok(db.data.users.every(u=>u.email.endsWith("@shieldai.demo")), "demo context sees only demo users");
});
ok(getStore(PROD_STORE).data.users.length===1 && getStore(DEMO_STORE).data.users.length===1, "writes did not bleed across files");

// Nested/concurrent: interleave async work in both stores
console.log("Concurrency:");
const results = await Promise.all([
  runInStore(DEMO_STORE, async () => { await new Promise(r=>setTimeout(r,20)); return db.data.users[0].email; }),
  runInStore(PROD_STORE, async () => { await new Promise(r=>setTimeout(r,10)); return db.data.users[0].email; }),
]);
ok(results[0]==="demo-client@shieldai.demo" && results[1]==="real@client.com", "concurrent requests stay in their own store");

console.log("Token boundary:");
const demoTok = signDemoToken({id:"d1", email:"demo-client@shieldai.demo", isAnalyst:false});
ok(!!verifyDemoToken(demoTok), "demo token verifies as demo");
let prodAccepted=true; try { jwt.verify(demoTok, "prod-secret"); } catch { prodAccepted=false; }
ok(!prodAccepted, "demo token REJECTED by production secret");
const prodTok = jwt.sign({userId:"p1", email:"real@client.com"}, "prod-secret");
ok(!verifyDemoToken(prodTok), "production token REJECTED as demo token");
const forged = jwt.sign({userId:"p1", store:"demo"}, "prod-secret");
ok(!verifyDemoToken(forged), "forged store claim signed with prod secret rejected");

console.log("Request routing:");
ok(isDemoRequest({path:"/api/demo/session", headers:{}})===true, "/api/demo/* → demo store");
ok(isDemoRequest({path:"/api/assessments", headers:{authorization:"Bearer "+demoTok}})===true, "demo token on real route → demo store");
ok(isDemoRequest({path:"/api/assessments", headers:{authorization:"Bearer "+prodTok}})===false, "prod token → prod store");
ok(isDemoRequest({path:"/api/assessments", headers:{}})===false, "anonymous → prod store");
ok(isDemoRequest({path:"/api/assessments", headers:{}, body:{store:"demo"}})===false, "body cannot select demo store");

console.log(fail? `\n${fail} FAILED` : "\nAll isolation tests passed");
process.exit(fail?1:0);
