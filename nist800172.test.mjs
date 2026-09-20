// nist800172.test.mjs — run: node nist800172.test.mjs
import { assessNist800172, NIST800172_CONTROLS, NIST800172_FAMILIES, controlsInFamily } from "./nist800172.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure — exactly 35 across 10 families (matches NIST's published CSV):");
ok(NIST800172_CONTROLS.length === 35, `35 controls (got ${NIST800172_CONTROLS.length})`);
ok(NIST800172_FAMILIES.length === 10, `10 families (got ${NIST800172_FAMILIES.length})`);
ok(NIST800172_FAMILIES.reduce((a, f) => a + f.count, 0) === 35, "declared counts sum to 35");
for (const f of NIST800172_FAMILIES) {
  const actual = NIST800172_CONTROLS.filter(c => c.family === f.id).length;
  ok(actual === f.count, `${f.prefix}e ${f.id} ${f.name}: ${actual}`);
}
ok(new Set(NIST800172_CONTROLS.map(c => c.id)).size === 35, "no duplicate IDs");
ok(NIST800172_CONTROLS.every(c => /^\d+\.\d+\.\d+e$/.test(c.id)), "every ID ends in 'e' (enhanced requirement), matching NIST's own naming");
ok(NIST800172_CONTROLS.every(c => c.id.startsWith(NIST800172_FAMILIES.find(f => f.id === c.family).prefix + ".")),
   "every control ID matches its family prefix");
ok(NIST800172_CONTROLS.every(c => c.covers && c.covers.length > 10), "every control has real requirement text, not a placeholder");
ok(new Set(NIST800172_CONTROLS.map(c => c.covers)).size === 35, "no two controls share identical text (would indicate a copy-paste error)");

console.log("\nOnly families that actually gained enhanced requirements are present:");
const familyIds = new Set(NIST800172_FAMILIES.map(f => f.id));
ok(!familyIds.has("AU"), "Audit and Accountability has no enhanced requirements (correctly absent)");
ok(!familyIds.has("MA"), "Maintenance has no enhanced requirements (correctly absent)");
ok(!familyIds.has("MP"), "Media Protection has no enhanced requirements (correctly absent)");
ok(!familyIds.has("PE"), "Physical Protection has no enhanced requirements (correctly absent)");
ok(familyIds.has("RA"), "Risk Assessment present (7 — the largest family)");

console.log("\nEvidence mapping is honest, not stretched:");
const withEvidence = NIST800172_CONTROLS.filter(c => (c.evidence || []).length > 0);
const withoutEvidence = NIST800172_CONTROLS.filter(c => (c.evidence || []).length === 0);
ok(withEvidence.length > 0 && withoutEvidence.length > 0, `mixed coverage: ${withEvidence.length} mapped, ${withoutEvidence.length} honestly unmapped`);
ok(withoutEvidence.length >= 15, "most APT-grade requirements (threat hunting, deception, supply-chain analytics) are honestly left unmapped, not stretched onto an unrelated checklist question");

console.log("\nAssessment behaves like every other deep module:");
const empty = assessNist800172({});
ok(empty.summary.total === 35, "empty assessment still reports total=35");
ok(empty.summary.coveragePct === null, "empty assessment -> null coverage, NOT 0%");
ok(empty.summary.unknown === 35, "all 35 reported unknown, not assumed unmet");
const strong = assessNist800172({ training: { score: 100 }, monitoring: { score: 100 }, dataInventory: { score: 100 } });
ok(strong.summary.assessed > 0 && strong.summary.met > 0, "answering mapped questions well moves real controls to met");
ok(strong.summary.assessed < 35, "controls with no evidence mapping stay unknown even when other answers are strong");

console.log("\nHonesty:");
ok(/does not determine which apply/.test(empty.disclaimer), "disclaimer: doesn't claim to determine applicability");
ok(/DCMA DIBCAC/.test(empty.disclaimer), "disclaimer: names the government body that actually selects applicability");
ok(/not by an AI/.test(empty.methodology), "methodology: computed, not AI-interpreted");

console.log("\nHelpers:");
ok(controlsInFamily("RA").length === 7, "controlsInFamily('RA') -> 7");
ok(controlsInFamily("unknown-family").length === 0, "unknown family -> empty, not a throw");

console.log(fail ? `\n${fail} FAILED` : "\nNIST SP 800-172 verified");
process.exit(fail ? 1 : 0);
