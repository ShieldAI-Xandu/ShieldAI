import fs from "fs";
import { assessSoc2, SOC2_SECURITY, SOC2_AVAILABILITY } from "./soc2.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";
let fail=0; const ok=(c,m)=>{console.log((c?"  ✔ ":"  ✖ ")+m);if(!c)fail++;};

console.log("Structure:");
const counts = SOC2_SECURITY.map(s=>s.criteria.length);
console.log("  CC series: " + SOC2_SECURITY.map((s,i)=>s.id+"="+counts[i]).join(" "));
ok(JSON.stringify(counts)===JSON.stringify([5,3,4,2,3,8,5,1,2]), "CC breakdown 5,3,4,2,3,8,5,1,2 = " + counts.reduce((a,b)=>a+b) + " (CC9 has 2: CC9.2 is vendor risk)");
ok(SOC2_SECURITY.length===9, "9 Common Criteria series (CC1-CC9)");
ok(SOC2_AVAILABILITY[0].criteria.length===3, "Availability has A1.1-A1.3");
const ids = [...SOC2_SECURITY.flatMap(s=>s.criteria.map(c=>c.id)), ...SOC2_AVAILABILITY.flatMap(s=>s.criteria.map(c=>c.id))];
ok(ids.every(i=>/^(CC[1-9]\.[0-9]|A1\.[0-9])$/.test(i)), "every criterion has a valid TSC identifier");
ok(new Set(ids).size===ids.length, "no duplicate identifiers");

console.log("\nCopyright safety:");
const src = fs.readFileSync("./soc2.js","utf8");
ok(/AICPA copyright/.test(src), "disclaimer names AICPA copyright");

console.log("\nReadiness for Meridian (real demo answers):");
const raw = { mfa:"Yes, but only on some accounts (e.g., admin)", endpoint:"Built-in protection (Windows Defender, etc.)",
  training:"Yes, occasional/annual training", itManagement:"Outsourced IT provider (MSP)",
  dataInventory:"Mostly — we have a general idea", priorAudit:"More than 2 years ago" };
const answers={};
for (const [id,label] of Object.entries(raw)) {
  const item=SECURITY_CHECKLIST.find(i=>i.id===id); const opt=item?.options.find(o=>o.label===label);
  if(opt) answers[id]={score:opt.score,label};
}
const r = assessSoc2(answers, { categories:["security","availability"] });
console.log("  scope: " + r.categoriesInScope.join(" + "));
console.log(`  ${r.summary.assessed}/${r.summary.criteria} assessed · ${r.summary.met} met · ${r.summary.partial} partial · ${r.summary.gaps} gaps · ${r.summary.unknown} not assessed`);
console.log("  readiness: " + r.summary.readinessPct + "%");
ok(r.summary.criteria===36, "36 criteria in scope (33 CC + 3 A1) = " + r.summary.criteria);
ok(r.summary.unknown>0, "unassessed criteria reported honestly");
console.log("  top gaps: " + r.topGaps.map(g=>g.id).join(", "));

console.log("\nSecurity is mandatory:");
const availOnly = assessSoc2(answers, { categories:["availability"] });
ok(availOnly.categoriesInScope.includes("Security"), "Security force-included even if not requested");
const justSec = assessSoc2(answers, { categories:["security"] });
ok(justSec.summary.criteria===33, "Security alone = 33 criteria (" + justSec.summary.criteria + ")");

console.log("\nHonesty:");
ok(/no such thing as being/i.test(r.criticalNote), "states SOC 2 certified does not exist");
ok(/not an attestation/i.test(r.disclaimer), "disclaimer: readiness, not attestation");
ok(/not by an AI/i.test(r.methodology), "methodology: computed, not AI-interpreted");
const empty = assessSoc2({});
ok(empty.summary.readinessPct===null, "empty assessment -> null readiness, NOT 100%");
console.log(fail?`\n${fail} FAILED`:"\nSOC 2 verified");
process.exit(fail?1:0);
