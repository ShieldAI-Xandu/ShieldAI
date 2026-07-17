// cmmc.test.mjs — run: node cmmc.test.mjs
import { assessCmmc, suggestCmmcLevel, level1Practices, CMMC_LEVELS } from "./cmmc.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Level determination:");
for (const [p, exp, label] of [
  [{ handlesCui: true }, 2, "handles CUI -> Level 2"],
  [{ handlesCui: false, handlesFci: true }, 1, "FCI only -> Level 1"],
  [{ handlesCui: false, handlesFci: false }, 0, "neither -> may not apply"],
  [{ highPriorityProgram: true }, 3, "high-priority programme -> Level 3"],
  [{}, 2, "unknown -> Level 2 (conservative)"],
]) ok(suggestCmmcLevel(p).level === exp, label);
ok(suggestCmmcLevel({}).confident === false, "unknown flagged not confident");
ok(/contracting officer/.test(suggestCmmcLevel({}).reason), "defers to contracting officer");
ok(/flows down/.test(suggestCmmcLevel({ handlesCui: false, handlesFci: false }).reason),
   "warns CUI flows down through subcontracts");

console.log("\nLevel 1 = 17 practices, a real subset:");
ok(level1Practices().length === 17, "17 practices");
ok(level1Practices().every(c => c.id && c.covers), "all resolve to real 800-171 controls");

console.log("\nScoping:");
const a1 = assessCmmc({}, { level: 1 });
const a2 = assessCmmc({}, { level: 2 });
ok(a1.summary.inScope === 17, "Level 1 -> 17 in scope");
ok(a2.summary.inScope === 110, "Level 2 -> 110 in scope");
ok(a1.summary.inScope < a2.summary.inScope, "Level 1 is a subset of Level 2");

console.log("\nNot-applicable path:");
const na = assessCmmc({}, { profile: { handlesCui: false, handlesFci: false } });
ok(na.applicable === false, "returns applicable:false, not a fake assessment");

console.log("\nLevel 3 states what it does NOT cover:");
const a3 = assessCmmc({}, { level: 3 });
ok(a3.level3Note !== null, "Level 3 note present");
ok(/800-172/.test(a3.level3Note), "explicit that the 800-172 layer isn't modelled");

console.log("\nWraps 800-171, duplicates nothing:");
ok(/adds the assessment and certification regime, not new controls/.test(a2.basisNote), "CMMC adds no controls");
ok(a2.sprs.computed === false, "SPRS honesty inherited");
ok(a2.requiredArtifacts.length === 2, "SSP + POA&M inherited");
ok(/Rev 2/.test(a2.revisionNote), "Rev 2 basis inherited");
ok(/10 November 2026/.test(a2.deadlineNote), "Phase 2 deadline");
ok(/C3PAO/.test(a2.disclaimer), "names C3PAO certification");
ok(assessCmmc({}, { level: 2 }).summary.coveragePct === null, "empty -> null, NOT 100%");

console.log(fail ? `\n${fail} FAILED` : "\nCMMC verified");
process.exit(fail ? 1 : 0);
