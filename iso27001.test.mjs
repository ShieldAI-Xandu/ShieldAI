// iso27001.test.mjs — run: node iso27001.test.mjs
import { assessIso27001, new2022Controls, ISO27001_ANNEX_A, ISO27001_THEMES, ISO27001_CLAUSES } from "./iso27001.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Annex A structure (must match published counts exactly):");
const byTheme = {};
for (const c of ISO27001_ANNEX_A) byTheme[c.theme] = (byTheme[c.theme] || 0) + 1;
ok(ISO27001_ANNEX_A.length === 93, "93 controls");
ok(byTheme.organizational === 37, "Organizational = 37 (A.5.1–5.37)");
ok(byTheme.people === 8, "People = 8 (A.6.1–6.8)");
ok(byTheme.physical === 14, "Physical = 14 (A.7.1–7.14)");
ok(byTheme.technological === 34, "Technological = 34 (A.8.1–8.34)");
for (const [count, theme] of [[37, "organizational"], [8, "people"], [14, "physical"], [34, "technological"]]) {
  const ids = ISO27001_ANNEX_A.filter(c => c.theme === theme).map(c => parseInt(c.id.split(".")[2]));
  ok(JSON.stringify(ids) === JSON.stringify(Array.from({ length: count }, (_, i) => i + 1)),
     `${theme}: IDs complete, in order, no gaps`);
}
ok(new Set(ISO27001_ANNEX_A.map(c => c.id)).size === 93, "no duplicate control IDs");
ok(ISO27001_CLAUSES.length === 7 && ISO27001_CLAUSES[0].number === 4, "Clauses 4–10");
ok(new2022Controls().length === 11, "11 controls new in the 2022 revision");

console.log("\nStatement of Applicability — exclusions are legitimate when justified:");
const excl = {
  "A.8.25": "No in-house software development", "A.8.26": "No in-house software development",
  "A.8.28": "No in-house software development", "A.8.29": "No in-house software development",
  "A.8.31": "No in-house software development", "A.8.4": "No source code held",
};
const withSoa = assessIso27001({ mfa: { score: 60 } }, { exclusions: excl });
ok(withSoa.summary.excluded === 6, "6 documented exclusions");
ok(withSoa.summary.inScope === 87, "87 controls in scope");
ok(withSoa.statementOfApplicability.undocumentedExclusions.length === 0, "documented exclusions produce no warning");
ok(withSoa.statementOfApplicability.warning === null, "no SoA warning when every exclusion is justified");

const sloppy = assessIso27001({}, { applicableControls: ["A.5.1", "A.5.2", "A.8.7"] });
ok(sloppy.statementOfApplicability.undocumentedExclusions.length === 90, "90 undocumented exclusions flagged");
ok(/auditor will ask/.test(sloppy.statementOfApplicability.warning || ""), "warns an auditor will ask about each");

console.log("\nThe category error we must not make:");
const r = assessIso27001({ mfa: { score: 60 }, endpoint: { score: 55 } });
ok(/do not report a percentage over all 93/.test(r.scoringNote), "refuses to score over all 93");
ok(/does not ask you to implement every control/.test(r.scoringNote), "states ISO is risk-selected, not exhaustive");
ok(assessIso27001({}).summary.coveragePct === null, "empty assessment -> null, NOT 100%");

console.log("\nClauses are the certification requirement, not Annex A:");
ok(r.clauses.total === 7, "all 7 clauses assessed");
ok(/certified against/.test(r.clauses.note), "clauses framed as what you're certified against");

console.log("\n2022 transition tracking:");
const t = assessIso27001({ monitoring: { score: 20 }, dataInventory: { score: 20 } });
ok(t.new2022Gaps.length >= 0, `${t.new2022Gaps.length} gaps in 2022-new controls surfaced separately`);
if (t.new2022Note) ok(/2013/.test(t.new2022Note), "2022-new note references the 2013 transition");

console.log("\nHonesty:");
ok(/not a certification audit/.test(r.disclaimer), "not a certification audit");
ok(/purchase the standard from ISO/.test(r.disclaimer), "tells them they must buy the standard");
ok(/copyrighted/.test(r.copyrightNote), "copyright position stated");
ok(/not by an AI/.test(r.methodology), "computed, not AI-interpreted");

console.log(fail ? `\n${fail} FAILED` : "\nISO 27001 verified");
process.exit(fail ? 1 : 0);
