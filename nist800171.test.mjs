// nist800171.test.mjs — run: node nist800171.test.mjs
import { assessNist800171, NIST800171_CONTROLS, NIST800171_FAMILIES, NIST800171_REV3 } from "./nist800171.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure — exactly 110 across 14 families:");
ok(NIST800171_CONTROLS.length === 110, "110 controls");
ok(NIST800171_FAMILIES.length === 14, "14 families");
ok(NIST800171_FAMILIES.reduce((a, f) => a + f.count, 0) === 110, "declared counts sum to 110");
for (const f of NIST800171_FAMILIES) {
  const actual = NIST800171_CONTROLS.filter(c => c.family === f.id).length;
  ok(actual === f.count, `${f.prefix} ${f.id} ${f.name}: ${actual}`);
}
ok(new Set(NIST800171_CONTROLS.map(c => c.id)).size === 110, "no duplicate IDs");
for (const f of NIST800171_FAMILIES) {
  const nums = NIST800171_CONTROLS.filter(c => c.family === f.id).map(c => parseInt(c.id.split(".")[2]));
  ok(JSON.stringify(nums) === JSON.stringify(Array.from({ length: f.count }, (_, i) => i + 1)),
     `${f.id}: sequential, no gaps`);
}
ok(NIST800171_CONTROLS.every(c => c.id.startsWith(NIST800171_FAMILIES.find(f => f.id === c.family).prefix + ".")),
   "every control ID matches its family prefix");
ok(NIST800171_CONTROLS.filter(c => c.basic).length === 0,
   "no basic/derived flags — the split isn't verified, so it isn't claimed");

console.log("\nRevision — Rev 2 despite Rev 3 existing:");
const r = assessNist800171({ mfa: { score: 60 } });
ok(r.revision === "Rev 2", "defaults to Rev 2");
ok(/not currently applicable/.test(r.revisionNote), "explains CMMC still references Rev 2");
ok(/10 November 2026/.test(r.deadlineNote), "surfaces the Phase 2 deadline");
ok(NIST800171_REV3.requirements === 97 && NIST800171_REV3.families === 17, "Rev 3 tracked: 97 reqs / 17 families");
ok(NIST800171_REV3.newFamilies.length === 3, "Rev 3's 3 new families (PL, SA, SR)");
ok(/Do not chase Rev 3/.test(NIST800171_REV3.guidance), "advises against chasing Rev 3 early");

console.log("\nSPRS — a number submitted to the government:");
ok(r.sprs.computed === false, "SPRS score NOT computed");
ok(/contractual representation/.test(r.sprs.why), "explains it's a contractual representation");
ok(/DoD Assessment Methodology/.test(r.sprs.whatToDo), "points at the real methodology");

console.log("\nRequired artifacts:");
ok(r.requiredArtifacts.some(a => a.id === "ssp" && a.control === "3.12.4"), "SSP tied to 3.12.4");
ok(r.requiredArtifacts.some(a => a.id === "poam" && a.control === "3.12.2"), "POA&M tied to 3.12.2");
ok(/not a failure/.test(r.requiredArtifacts.find(a => a.id === "poam").why), "POA&M framed as expected, not failure");

console.log("\nHonesty:");
ok(/not an SPRS score/.test(r.disclaimer), "not an SPRS score");
ok(/not a CMMC certification/.test(r.disclaimer), "not a CMMC certification");
ok(/not by an AI/.test(r.methodology), "computed, not AI-interpreted");
ok(assessNist800171({}).summary.coveragePct === null, "empty -> null, NOT 100%");

console.log(fail ? `\n${fail} FAILED` : "\nNIST 800-171 verified");
process.exit(fail ? 1 : 0);
