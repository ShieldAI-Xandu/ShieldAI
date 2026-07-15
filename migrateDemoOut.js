// migrateDemoOut.js
// One-time migration: remove the legacy demo account and all of its data from
// the PRODUCTION store (db.json).
//
// Before the demo/production split, demo@shieldai.com lived in db.json
// alongside real accounts. It doesn't belong there anymore — demo identities
// now live only in demo-db.json and are recreated by `node seedDemo.js`.
//
// Run:  node migrateDemoOut.js          (dry run — shows what it would remove)
//       node migrateDemoOut.js --apply  (actually removes it)
//
// A timestamped backup of db.json is written before any change.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getStore, PROD_STORE } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = process.env.DB_DIR || __dirname;
const APPLY = process.argv.includes("--apply");

// Legacy demo identities that predate the split.
const LEGACY_DEMO_EMAILS = ["demo@shieldai.com"];

const OWNED_BY_USER = [
  ["assessments", "userId"],
  ["programs", "userId"],
  ["policyDocs", "userId"],
  ["trainingPrograms", "userId"],
  ["agents", "ownerUserId"],
  ["agentReports", "ownerUserId"],
  ["agentEvents", "ownerUserId"],
  ["recommendations", "ownerUserId"],
  ["enrollTokens", "ownerUserId"],
  ["subscriptions", "userId"],
  ["transactions", "userId"],
  ["clientActions", "clientUserId"],
];

const prod = getStore(PROD_STORE);
await prod.read();

const targets = (prod.data.users || []).filter(
  u => LEGACY_DEMO_EMAILS.includes(u.email) || (u.email || "").endsWith("@shieldai.demo") || u.isDemo
);

if (!targets.length) {
  console.log("✔ Production store is already clean — no demo accounts in db.json.");
  process.exit(0);
}

const ids = new Set(targets.map(u => u.id));
console.log(`Found ${targets.length} demo account(s) in the PRODUCTION store:`);
for (const u of targets) console.log(`  · ${u.email} (${u.id})`);

let total = 0;
console.log("\nAssociated records that would be removed:");
for (const [coll, key] of OWNED_BY_USER) {
  const n = (prod.data[coll] || []).filter(r => ids.has(r[key])).length;
  if (n) { console.log(`  · ${coll}: ${n}`); total += n; }
}
const assignN = (prod.data.assignments || []).filter(a => ids.has(a.clientUserId) || ids.has(a.analystUserId)).length;
if (assignN) { console.log(`  · assignments: ${assignN}`); total += assignN; }
console.log(`  (${total} records total)`);

if (!APPLY) {
  console.log("\nDry run. Nothing changed. Re-run with --apply to remove:");
  console.log("  node migrateDemoOut.js --apply");
  process.exit(0);
}

// Back up first — this deletes data, so make it recoverable.
const src = path.join(DB_DIR, "db.json");
const backup = path.join(DB_DIR, `db.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.copyFileSync(src, backup);
console.log(`\nBackup written: ${backup}`);

prod.data.users = prod.data.users.filter(u => !ids.has(u.id));
for (const [coll, key] of OWNED_BY_USER) {
  prod.data[coll] = (prod.data[coll] || []).filter(r => !ids.has(r[key]));
}
prod.data.assignments = (prod.data.assignments || []).filter(
  a => !ids.has(a.clientUserId) && !ids.has(a.analystUserId)
);
await prod.write();

console.log("✔ Production store cleaned.");
console.log("  Next: node seedDemo.js   (rebuilds the sandbox in demo-db.json)");
process.exit(0);
