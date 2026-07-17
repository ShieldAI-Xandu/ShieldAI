// nist80053.test.mjs — run: node nist80053.test.mjs
import {
  assessNist80053, NIST80053_CONTROLS, NIST80053_FAMILIES,
  NIST80053_META, NIST80053_BASELINES, baselineGuidance, controlsInFamily,
} from "./nist80053.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure — exactly 149 across 18 families (from NIST's OSCAL profile):");
ok(NIST80053_CONTROLS.length === 149, `149 controls (got ${NIST80053_CONTROLS.length})`);
ok(NIST80053_FAMILIES.length === 18, `18 families (got ${NIST80053_FAMILIES.length})`);
ok(NIST80053_FAMILIES.reduce((a, f) => a + f.count, 0) === 149, "declared counts sum to 149");
for (const f of NIST80053_FAMILIES) {
  const actual = NIST80053_CONTROLS.filter(c => c.family === f.id).length;
  ok(actual === f.count, `${f.id} ${f.name}: ${actual}`);
}
ok(new Set(NIST80053_CONTROLS.map(c => c.id)).size === 149, "no duplicate control IDs");
ok(NIST80053_CONTROLS.every(c => c.title && c.title.length > 2), "every control has a real NIST title");
ok(NIST80053_CONTROLS.every(c => NIST80053_FAMILIES.some(f => f.id === c.family)),
   "every control belongs to a declared family");

console.log("\nThe 18-vs-20 family question — PM and PT are absent by NIST's design:");
ok(!NIST80053_FAMILIES.some(f => f.id === "PM"), "PM (Program Management) not in the Low baseline");
ok(!NIST80053_FAMILIES.some(f => f.id === "PT"), "PT (PII Processing) not in the Low baseline");

console.log("\nEnhancements are included and formatted as NIST writes them:");
const enh = NIST80053_CONTROLS.filter(c => /\(\d+\)$/.test(c.id));
ok(enh.length === 18, `18 control enhancements (got ${enh.length})`);
ok(NIST80053_CONTROLS.some(c => c.id === "IA-2(1)"), "IA-2(1) present, parenthesised not dotted");

console.log("\nBaseline honesty — we ship Low and say so:");
ok(NIST80053_META.baseline === "low", "meta declares the Low baseline");
ok(NIST80053_BASELINES.low.controls === 149 && NIST80053_BASELINES.low.assessed === true, "Low: 149, assessed");
ok(NIST80053_BASELINES.moderate.controls === 287 && NIST80053_BASELINES.moderate.assessed === false,
   "Moderate: 287, NOT assessed");
ok(NIST80053_BASELINES.high.controls === 370 && NIST80053_BASELINES.high.assessed === false,
   "High: 370, NOT assessed");
ok(/FIPS 199/.test(NIST80053_META.baselineNote), "points at FIPS 199 to decide the baseline");
ok(/assessor/.test(baselineGuidance().weDoNotAssess), "says Moderate needs an assessor, not this tool");

console.log("\nEvidence mapping — no control silently unassessable:");
const qIds = new Set(SECURITY_CHECKLIST.map(q => q.id));
ok(NIST80053_CONTROLS.every(c => (c.evidence || []).length > 0), "every control has at least one evidence mapping");
const bad = NIST80053_CONTROLS.flatMap(c => (c.evidence || []).filter(e => !qIds.has(e)));
ok(bad.length === 0, `every evidence ID exists in the checklist${bad.length ? " — BROKEN: " + [...new Set(bad)] : ""}`);

console.log("\nMapping fidelity — we admit our own resolution:");
const r = assessNist80053({ mfa: { score: 60 }, monitoring: { score: 30 } });
ok(r.mappingFidelity.level === "family-informed", "declares family-informed fidelity");
ok(/149/.test(r.mappingFidelity.what) && /35/.test(r.mappingFidelity.what),
   "names the real ratio (35 questions vs 149 controls)");
ok(/not a control-by-control audit/.test(r.mappingFidelity.soWhat), "says it is not an audit");

console.log("\nRequired artifacts:");
const ids = r.requiredArtifacts.map(a => a.id);
ok(ids.includes("ssp"), "System Security Plan (PL-2)");
ok(ids.includes("poam"), "POA&M (CA-5)");
ok(ids.includes("categorization"), "FIPS 199 categorization (RA-2) — do this first");
ok(r.requiredArtifacts.every(a => NIST80053_CONTROLS.some(c => c.id === a.control)),
   "every cited artifact control is actually in the Low baseline");

console.log("\nScoring — the no-fabrication rules:");
const empty = assessNist80053({});
ok(empty.summary.coveragePct === null, "empty assessment -> null, NOT 100%");
ok(empty.summary.unknown === 149, "empty -> all 149 'not yet assessed'");
ok(empty.summary.met === 0 && empty.summary.assessed === 0, "empty -> nothing met, nothing assessed");
ok(r.summary.assessed < 149, "partial answers -> partial assessment, not full coverage");
ok(r.summary.coveragePct === null || (r.summary.coveragePct >= 0 && r.summary.coveragePct <= 100),
   "coveragePct is a real percentage or null");
const strong = assessNist80053(Object.fromEntries(SECURITY_CHECKLIST.map(q => [q.id, { score: 100 }])));
ok(strong.summary.coveragePct === 100, "all-100 answers -> 100% of assessed controls met");
ok(strong.summary.unknown === 0, "all answered -> nothing unknown");

console.log("\nProvenance and copyright:");
ok(NIST80053_META.publicDomain === true, "public domain — NIST works carry no copyright");
ok(/OSCAL/.test(r.methodology), "methodology names the OSCAL source");
ok(/computed|fixed rule/.test(r.methodology), "computed, not AI-interpreted");
ok(/not an ATO|not a FedRAMP/.test(r.disclaimer), "disclaimer: not an ATO, not FedRAMP");

console.log("\nHelpers:");
ok(controlsInFamily("AC").length === 11, "controlsInFamily('AC') -> 11");
ok(controlsInFamily("ZZ").length === 0, "unknown family -> empty, not a throw");

console.log(fail ? `\n${fail} FAILED` : "\nNIST 800-53 verified");
process.exit(fail ? 1 : 0);
