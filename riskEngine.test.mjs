// riskEngine.test.mjs — run: node riskEngine.test.mjs
//
// THIS FILE EXISTS TO PROTECT ONE CLAIM.
//
// The pitch says the posture score is deterministic, explainable, and
// repeatable — that's the trust anchor for insurers and auditors, and it's
// slide 10. That claim dies quietly the first time someone adds a checklist
// question and every historical client's score shifts underneath them.
//
// riskEngine.scoreFromChecklist() normalises by total factor weight across
// whatever questions it is handed. So the failure mode is not a crash — it's a
// silent, retroactive drift in a number customers have already been shown and
// may have given to their insurer. These tests pin the boundary: 13 scoring
// questions, evidence questions invisible to the engine, known input -> known
// output.
//
// If you are here because this test failed: you either added a question
// without `scoring: false`, or changed a factor weight. If the change is
// deliberate, that is a scoring-methodology version bump — a product decision
// with customer-communication consequences, not a test to update quietly.

import { computePostureScore } from "./riskEngine.js";
import { SECURITY_CHECKLIST, SCORING_CHECKLIST, EVIDENCE_CHECKLIST, toEvidence, evidenceSections } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("The scoring/evidence boundary:");
ok(SCORING_CHECKLIST.length === 13, `exactly 13 scoring questions (got ${SCORING_CHECKLIST.length})`);
ok(SCORING_CHECKLIST.every(q => q.nistFunction && q.factor), "every scoring question has a nistFunction and factor");
ok(EVIDENCE_CHECKLIST.every(q => q.scoring === false), "every evidence question is flagged scoring: false");
ok(EVIDENCE_CHECKLIST.every(q => !q.factor), "no evidence question carries a scoring factor");
ok(SCORING_CHECKLIST.length + EVIDENCE_CHECKLIST.length === SECURITY_CHECKLIST.length,
   "the two sets partition the checklist exactly");
ok(new Set(SECURITY_CHECKLIST.map(q => q.id)).size === SECURITY_CHECKLIST.length, "no duplicate question IDs");
ok(SECURITY_CHECKLIST.every(q => q.options && q.options.length >= 2), "every question has options");
ok(SECURITY_CHECKLIST.every(q => q.options.every(o => typeof o.score === "number" && o.score >= 0 && o.score <= 100)),
   "every option score is 0-100");

console.log("\nThe five NIST functions, and only those:");
const fns = [...new Set(SCORING_CHECKLIST.map(q => q.nistFunction))].sort();
ok(JSON.stringify(fns) === JSON.stringify(["Detect", "Identify", "Protect", "Recover", "Respond"]),
   `exactly the five CSF functions (got ${fns.join(", ")})`);

console.log("\nFROZEN BASELINE — a known assessment must always score the same:");
// A deliberately middling profile. If this number moves, every customer's
// number moved.
const MID = {
  mfa: "Yes, but only on some accounts (e.g., admin)",
  endpoint: "Built-in protection (Windows Defender, etc.)",
  training: "Yes, occasional/annual training",
  itManagement: "Outsourced IT provider (MSP)",
  dataInventory: "Mostly — we have a general idea",
  priorAudit: "1-2 years ago",
  documentedPolicies: "A few key policies",
  monitoring: "Some logging, reviewed occasionally",
  emailSecurity: "Built-in filtering (Microsoft 365 / Google Workspace)",
  incidentResponse: "Yes, documented but not tested",
  responseSupport: "Internal IT staff",
  backups: "Automated backups, not regularly tested",
  disasterRecovery: "Yes, a basic plan",
};
const mid = computePostureScore({ checklist: MID });
ok(mid.postureScore === 65, `mid profile scores exactly 65 (got ${mid.postureScore})`);
ok(mid.postureLevel === "Moderate", `mid profile is Moderate (got ${mid.postureLevel})`);
const byFn = Object.fromEntries(mid.functions.map(f => [f.name, f.score]));
ok(byFn.Protect === 66, `Protect = 66 (got ${byFn.Protect})`);
ok(byFn.Identify === 60, `Identify = 60 (got ${byFn.Identify})`);
ok(byFn.Detect === 60, `Detect = 60 (got ${byFn.Detect})`);
ok(byFn.Respond === 70, `Respond = 70 (got ${byFn.Respond})`);
ok(byFn.Recover === 68, `Recover = 68 (got ${byFn.Recover})`);

console.log("\nEVIDENCE ANSWERS MUST NOT MOVE THE SCORE — the whole point:");
const withEvidence = { ...MID };
for (const q of EVIDENCE_CHECKLIST) withEvidence[q.id] = q.options[0].label; // best possible
const boosted = computePostureScore({ checklist: withEvidence });
ok(boosted.postureScore === mid.postureScore,
   `answering all ${EVIDENCE_CHECKLIST.length} evidence questions PERFECTLY does not change the score (${mid.postureScore} -> ${boosted.postureScore})`);
const worst = { ...MID };
for (const q of EVIDENCE_CHECKLIST) worst[q.id] = q.options[q.options.length - 1].label; // worst possible
const tanked = computePostureScore({ checklist: worst });
ok(tanked.postureScore === mid.postureScore,
   `answering all evidence questions at WORST does not change the score (${mid.postureScore} -> ${tanked.postureScore})`);
ok(boosted.functions.length === 5, "evidence answers do not invent new NIST functions");
ok(JSON.stringify(boosted.functions.map(f => f.score)) === JSON.stringify(mid.functions.map(f => f.score)),
   "no function score moves");

console.log("\nBoundaries:");
const perfect = computePostureScore({ checklist: Object.fromEntries(SCORING_CHECKLIST.map(q => [q.id, q.options[0].label])) });
// 99, not 100 — and that is correct, not an off-by-one. Two questions cap their
// best answer at 90: itManagement ("Dedicated in-house IT/security staff") and
// responseSupport ("Retained security firm / MSP on call"). Both are the best
// answer available, and neither is a perfect state — having staff is not the
// same as having a mature function. A 100 would claim a certainty the intake
// cannot support. Pinned here so nobody "fixes" it into a round number.
ok(perfect.postureScore === 99, `all-best answers -> 99, not 100 (got ${perfect.postureScore})`);
ok(perfect.postureLevel === "Strong", "all-best -> Strong");
const capped = SCORING_CHECKLIST.filter(q => q.options[0].score < 100).map(q => q.id);
ok(JSON.stringify(capped) === JSON.stringify(["itManagement", "responseSupport"]),
   `only itManagement and responseSupport cap below 100 (got ${capped.join(", ") || "none"})`);
const floor = computePostureScore({ checklist: Object.fromEntries(SCORING_CHECKLIST.map(q => [q.id, q.options[q.options.length - 1].label])) });
ok(floor.postureScore <= 25, `all-worst -> low score (got ${floor.postureScore})`);
ok(floor.postureLevel === "At Risk", "all-worst -> At Risk");
ok(computePostureScore({ checklist: MID }).postureScore === mid.postureScore, "repeatable — same input, same output");

console.log("\nScoring mode:");
ok(mid.scoringMode === "structured", "checklist answers -> structured mode");
ok(computePostureScore({ company: { name: "X" } }).scoringMode === "inferred",
   "no checklist -> falls back to inferred mode, doesn't throw");

console.log("\ntoEvidence() — the shape frameworks read:");
const ev = toEvidence({ mfa: "Yes, required on all accounts", privacyNotice: "No" });
ok(ev.mfa && ev.mfa.score === 100, "resolves a scoring answer to { label, score }");
ok(ev.privacyNotice && ev.privacyNotice.score === 10, "resolves an evidence answer too");
ok(!("backups" in ev), "unanswered questions are ABSENT, not zero — 'not assessed' != 'failed'");
ok(Object.keys(toEvidence({ mfa: "not a real option" })).length === 0, "an invalid label is dropped, not guessed");
ok(Object.keys(toEvidence({})).length === 0, "empty answers -> empty evidence");

console.log("\nEvidence sections (intake UI grouping):");
const secs = evidenceSections();
ok(secs.length === 5, `5 evidence sections (got ${secs.length})`);
ok(secs.every(s => s.section && s.questions.length > 0), "every section is named and non-empty");
ok(secs.some(s => s.section === "Privacy"), "Privacy section exists — it unblocks the state privacy framework");
ok(secs.reduce((a, s) => a + s.questions.length, 0) === EVIDENCE_CHECKLIST.length,
   "sections account for every evidence question");

console.log(fail ? `\n${fail} FAILED` : "\nRisk engine verified — posture score is stable");

// ── Framework lens (NIST / CIS / both) ────────────────────────
// The client chooses their scoring lens at intake. The load-bearing guarantee
// is that choosing a different lens does NOT change how secure the business is —
// same answers, same underlying arithmetic, only the grouping and label differ.
// A business that scored 65 in NIST terms cannot become "at risk" because it
// clicked CIS.
console.log("\nFramework lens — same answers, different frame, never a contradiction:");
const { computePostureForLens } = await import("./riskEngine.js");
const bestOpt = (q) => q.options.reduce((a, b) => (b.score > a.score ? b : a));
const best = {}; for (const q of SCORING_CHECKLIST) best[q.id] = bestOpt(q).label;
const lensMid = {}; for (const q of SCORING_CHECKLIST) lensMid[q.id] = q.options[Math.floor(q.options.length / 2)]?.label || q.options[0].label;

const nist = computePostureForLens({ checklist: lensMid }, "nist");
const cis = computePostureForLens({ checklist: lensMid }, "cis");
const both = computePostureForLens({ checklist: lensMid }, "both");

ok(nist.lens === "nist" && nist.functions.length === 5, "NIST lens -> 5 functions");
ok(cis.lens === "cis" && cis.functions.length === 4, "CIS lens -> 4 hygiene groups");
ok(cis.frameworkLens === "CIS Controls v8.1", "CIS lens is labelled as such");
ok(both.postureScore === nist.postureScore, "'both' keeps the NIST number as the headline — no disagreement on the score");
ok(both.alternateView && both.alternateView.postureScore === cis.postureScore, "'both' carries the CIS view alongside");
ok(cis.alternateView && cis.alternateView.postureScore === nist.postureScore, "CIS lens keeps NIST available for cross-framework needs");
ok(Math.abs(nist.postureScore - cis.postureScore) <= 12,
   `NIST (${nist.postureScore}) and CIS (${cis.postureScore}) agree within a reasonable band — same business, not two verdicts`);
ok(computePostureForLens({ checklist: lensMid }).lens === "nist", "no lens argument defaults to NIST");

// The stored-field path the routes actually use.
ok(computePostureScore({ checklist: lensMid }).postureScore === nist.postureScore, "no frameworkLens on data -> NIST (backwards compatible)");
ok(computePostureScore({ checklist: lensMid, frameworkLens: "cis" }).frameworkLens === "CIS Controls v8.1",
   "frameworkLens on the assessment data drives the lens — the 15 call sites need no changes");

// Sanity: an all-best assessment is Strong under either lens. A framework
// choice can't turn an excellent program into a failing one.
ok(computePostureForLens({ checklist: best }, "nist").postureLevel === "Strong", "all-best -> Strong under NIST");
ok(["Strong", "Moderate"].includes(computePostureForLens({ checklist: best }, "cis").postureLevel),
   "all-best -> Strong/Moderate under CIS — never worse than Developing");

console.log(fail ? `\n${fail} FAILED (lens)` : "\nFramework lens verified");
process.exit(fail ? 1 : 0);
