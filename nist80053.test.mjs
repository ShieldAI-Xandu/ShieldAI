// nist80053.test.mjs — run: node nist80053.test.mjs
import {
  assessNist80053, NIST80053_CONTROLS, NIST80053_FAMILIES,
  NIST80053_META, NIST80053_BASELINES, baselineGuidance, controlsInFamily,
} from "./nist80053.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure — 370 controls across 18 families, cumulative Low/Moderate/High:");
ok(NIST80053_CONTROLS.length === 370, `370 distinct controls (got ${NIST80053_CONTROLS.length})`);
ok(NIST80053_FAMILIES.length === 18, `18 families (got ${NIST80053_FAMILIES.length})`);
ok(new Set(NIST80053_CONTROLS.map(c => c.id)).size === 370, "no duplicate control IDs");
ok(NIST80053_CONTROLS.every(c => c.title && c.title.length > 2), "every control has a real NIST title");
ok(NIST80053_CONTROLS.every(c => NIST80053_FAMILIES.some(f => f.id === c.family)),
   "every control belongs to a declared family");

for (const bl of ["low", "moderate", "high"]) {
  const expected = NIST80053_BASELINES[bl].controls;
  const actual = NIST80053_CONTROLS.filter(c => c.baselines.includes(bl)).length;
  ok(actual === expected, `${bl}: ${actual} controls (expected ${expected})`);
  const famSum = NIST80053_FAMILIES.reduce((a, f) => a + f.counts[bl], 0);
  ok(famSum === expected, `${bl}: declared per-family counts sum to ${expected} (got ${famSum})`);
  for (const f of NIST80053_FAMILIES) {
    const famActual = NIST80053_CONTROLS.filter(c => c.family === f.id && c.baselines.includes(bl)).length;
    ok(famActual === f.counts[bl], `${bl} ${f.id}: declared ${f.counts[bl]}, actual ${famActual}`);
  }
}

console.log("\nBaselines are strictly cumulative (Low ⊂ Moderate ⊂ High):");
const lowIds = new Set(NIST80053_CONTROLS.filter(c => c.baselines.includes("low")).map(c => c.id));
const modIds = new Set(NIST80053_CONTROLS.filter(c => c.baselines.includes("moderate")).map(c => c.id));
const highIds = new Set(NIST80053_CONTROLS.filter(c => c.baselines.includes("high")).map(c => c.id));
ok([...lowIds].every(id => modIds.has(id)), "every Low control is in Moderate");
ok([...modIds].every(id => highIds.has(id)), "every Moderate control is in High");
ok(lowIds.size < modIds.size && modIds.size < highIds.size, "each baseline strictly grows");

console.log("\nThe 18-vs-20 family question — PM and PT are absent by NIST's design, at every baseline:");
ok(!NIST80053_FAMILIES.some(f => f.id === "PM"), "PM (Program Management) not present");
ok(!NIST80053_FAMILIES.some(f => f.id === "PT"), "PT (PII Processing) not present");

console.log("\nEnhancements are included and formatted as NIST writes them:");
ok(NIST80053_CONTROLS.some(c => c.id === "IA-2(1)"), "IA-2(1) present, parenthesised not dotted");
ok(NIST80053_CONTROLS.some(c => c.id === "AC-2(13)"), "AC-2(13) present (double-digit enhancement)");

console.log("\nBaseline honesty — all three are now real, computed assessments:");
ok(NIST80053_BASELINES.low.controls === 149 && NIST80053_BASELINES.low.assessed === true, "Low: 149, assessed");
ok(NIST80053_BASELINES.moderate.controls === 287 && NIST80053_BASELINES.moderate.assessed === true, "Moderate: 287, assessed");
ok(NIST80053_BASELINES.high.controls === 370 && NIST80053_BASELINES.high.assessed === true, "High: 370, assessed");
ok(/FIPS 199/.test(NIST80053_META.baselineNote), "points at FIPS 199 to decide the baseline");
ok(baselineGuidance().weAssess.includes("370"), "baselineGuidance names all three as assessed");

console.log("\nassessNist80053({baseline}) actually changes what's assessed:");
ok(assessNist80053({}).summary.total === 149, "no baseline arg -> defaults to Low (149), the conservative choice");
ok(assessNist80053({}, { baseline: "low" }).summary.total === 149, "explicit low -> 149");
ok(assessNist80053({}, { baseline: "moderate" }).summary.total === 287, "moderate -> 287");
ok(assessNist80053({}, { baseline: "high" }).summary.total === 370, "high -> 370");
ok(assessNist80053({}, { baseline: "not-a-real-baseline" }).summary.total === 149, "unknown baseline falls back to low, not a throw");
ok(assessNist80053({}, { baseline: "moderate" }).baseline === "Moderate", "response names the baseline actually used");

console.log("\nEvidence mapping gets sparser as the baseline grows — honest, not stretched:");
const qIds = new Set(SECURITY_CHECKLIST.map(q => q.id));
const bad = NIST80053_CONTROLS.flatMap(c => (c.evidence || []).filter(e => !qIds.has(e)));
ok(bad.length === 0, `every evidence ID exists in the checklist${bad.length ? " — BROKEN: " + [...new Set(bad)] : ""}`);
const lowUnmapped = NIST80053_CONTROLS.filter(c => c.baselines.includes("low") && (c.evidence || []).length === 0).length;
const highOnlyUnmapped = NIST80053_CONTROLS.filter(c => !c.baselines.includes("moderate") && (c.evidence || []).length === 0).length;
ok(lowUnmapped === 0, "every Low-baseline control has at least one evidence mapping (unchanged discipline)");
ok(highOnlyUnmapped > 0, `High-only controls include honestly-unmapped ones (${highOnlyUnmapped}) — not stretched onto unrelated questions`);

console.log("\nMapping fidelity — we admit our own resolution, and it scales with baseline size:");
const rLow = assessNist80053({ mfa: { score: 60 }, monitoring: { score: 30 } });
const rHigh = assessNist80053({ mfa: { score: 60 }, monitoring: { score: 30 } }, { baseline: "high" });
ok(rLow.mappingFidelity.level === "family-informed", "declares family-informed fidelity");
ok(/149/.test(rLow.mappingFidelity.what) && /35/.test(rLow.mappingFidelity.what), "Low: names the real ratio (35 questions vs 149 controls)");
ok(/370/.test(rHigh.mappingFidelity.what), "High: names its own real ratio (370 controls)");
ok(/not a control-by-control audit/.test(rLow.mappingFidelity.soWhat), "says it is not an audit");

console.log("\nRequired artifacts (present at every baseline, since PL-2/CA-5/RA-2 are in all three):");
const ids = rLow.requiredArtifacts.map(a => a.id);
ok(ids.includes("ssp"), "System Security Plan (PL-2)");
ok(ids.includes("poam"), "POA&M (CA-5)");
ok(ids.includes("categorization"), "FIPS 199 categorization (RA-2) — do this first");
ok(rLow.requiredArtifacts.every(a => NIST80053_CONTROLS.some(c => c.id === a.control && c.baselines.includes("low"))),
   "every cited artifact control is actually in the Low baseline");

console.log("\nScoring — the no-fabrication rules, checked at each baseline:");
for (const [bl, total] of [["low", 149], ["moderate", 287], ["high", 370]]) {
  const empty = assessNist80053({}, { baseline: bl });
  ok(empty.summary.coveragePct === null, `${bl}: empty assessment -> null, NOT 100%`);
  ok(empty.summary.unknown === total, `${bl}: empty -> all ${total} 'not yet assessed'`);
  ok(empty.summary.met === 0 && empty.summary.assessed === 0, `${bl}: empty -> nothing met, nothing assessed`);
}
const allAnswered = Object.fromEntries(SECURITY_CHECKLIST.map(q => [q.id, { score: 100 }]));
const strongHigh = assessNist80053(allAnswered, { baseline: "high" });
ok(strongHigh.summary.coveragePct === 100, "High, all-100 answers -> 100% of assessed controls met");
ok(strongHigh.summary.unknown > 0, "High: even all-100 leaves the honestly-unmapped controls unknown, not falsely met");

console.log("\nProvenance and copyright:");
ok(NIST80053_META.publicDomain === true, "public domain — NIST works carry no copyright");
ok(/OSCAL/.test(rLow.methodology), "methodology names the OSCAL source");
ok(/computed|fixed rule/.test(rLow.methodology), "computed, not AI-interpreted");
ok(/not an ATO|not a FedRAMP/.test(rLow.disclaimer), "disclaimer: not an ATO, not FedRAMP");

console.log("\nHelpers:");
ok(controlsInFamily("AC").length === 46, "controlsInFamily('AC') -> 46 (across all baselines)");
ok(controlsInFamily("ZZ").length === 0, "unknown family -> empty, not a throw");

console.log(fail ? `\n${fail} FAILED` : "\nNIST 800-53 verified");
process.exit(fail ? 1 : 0);
