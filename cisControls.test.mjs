// cisControls.test.mjs — run: node cisControls.test.mjs
import { assessCis, controlsForIG, CIS_CONTROLS, CIS_IMPLEMENTATION_GROUPS } from "./cisControls.js";
import { evaluateFramework } from "./complianceBridge.js";
import { toAssessOpts } from "./frameworkIntake.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Implementation Groups are cumulative:");
ok(controlsForIG("IG1").length === 15, `IG1 -> 15 controls (got ${controlsForIG("IG1").length})`);
ok(controlsForIG("IG2").length === 18, `IG2 -> 18 controls (got ${controlsForIG("IG2").length})`);
ok(controlsForIG("IG3").length === 18, `IG3 -> 18 controls (got ${controlsForIG("IG3").length})`);
ok(controlsForIG("IG1").every(c => controlsForIG("IG2").some(c2 => c2.id === c.id)), "IG1 is a strict subset of IG2");
ok(controlsForIG("IG2").every(c => controlsForIG("IG3").some(c2 => c2.id === c.id)), "IG2 is a strict subset of IG3");
ok(controlsForIG("unknown-ig").length === controlsForIG("IG1").length, "unknown IG falls back to IG1, not a throw");

console.log("\nassessCis() actually changes scope by IG (the wiring this file exists to verify):");
const ig1 = assessCis({}, { ig: "IG1" });
const ig2 = assessCis({}, { ig: "IG2" });
ok(ig1.summary.total === 15, `IG1 assessment -> 15 elements (got ${ig1.summary.total})`);
ok(ig2.summary.total === 18, `IG2 assessment -> 18 elements (got ${ig2.summary.total})`);
ok(ig1.implementationGroup.id === "IG1", "reports the IG it was actually assessed at");
ok(assessCis({}).implementationGroup.id === "IG1", "no ig given -> defaults to IG1 (the conservative default)");

console.log("\nEnd-to-end: a client's real IG choice reaches scoring, not a silent IG1 default:");
const checklist = { dataInventory: "Yes, fully documented inventory" };
const asIG1 = evaluateFramework("cis", checklist, toAssessOpts("cis", { implementationGroup: "IG1" }));
const asIG2 = evaluateFramework("cis", checklist, toAssessOpts("cis", { implementationGroup: "IG2" }));
ok(asIG1.summary.total === 15, `evaluateFramework honors IG1 (got ${asIG1.summary.total})`);
ok(asIG2.summary.total === 18, `evaluateFramework honors IG2, not stuck at IG1 (got ${asIG2.summary.total})`);
ok(asIG1.summary.total !== asIG2.summary.total, "different IG choices produce genuinely different scope");

console.log("\nCatalogue integrity:");
ok(new Set(CIS_CONTROLS.map(c => c.id)).size === CIS_CONTROLS.length, "no duplicate control IDs");
ok(CIS_CONTROLS.every(c => c.id && c.name && c.summary), "every control has a real title and summary");
ok(Object.keys(CIS_IMPLEMENTATION_GROUPS).length === 3, "exactly 3 Implementation Groups");

console.log(fail ? `\n${fail} FAILED` : "\nCIS Controls verified");
process.exit(fail ? 1 : 0);
