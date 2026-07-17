// statePrivacy.test.mjs — run: node statePrivacy.test.mjs
import {
  assessStatePrivacy, STATE_PRIVACY_OBLIGATIONS, STATE_PRIVACY_AREAS,
  STATE_PRIVACY_META, STATE_ROSTER, applicabilityPrompt, obligationsInArea,
} from "./statePrivacy.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure — 18 obligations across 6 areas:");
ok(STATE_PRIVACY_OBLIGATIONS.length === 18, `18 obligations (got ${STATE_PRIVACY_OBLIGATIONS.length})`);
ok(STATE_PRIVACY_AREAS.length === 6, `6 areas (got ${STATE_PRIVACY_AREAS.length})`);
ok(new Set(STATE_PRIVACY_OBLIGATIONS.map(o => o.id)).size === 18, "no duplicate obligation IDs");
ok(STATE_PRIVACY_OBLIGATIONS.every(o => STATE_PRIVACY_AREAS.some(a => a.id === o.area)),
   "every obligation belongs to a declared area");
ok(STATE_PRIVACY_OBLIGATIONS.every(o => o.citation && o.citation.length > 5),
   "every obligation carries a statutory citation");
ok(STATE_PRIVACY_OBLIGATIONS.every(o => /^SP-\d+$/.test(o.id)), "IDs follow the SP-n convention");

console.log("\nThe count is contested — we say so instead of picking a number:");
ok(STATE_ROSTER.countIsContested === true, "roster flags the count as contested");
ok(/19, 20, 23, and 24/.test(STATE_ROSTER.countNote), "names the actual conflicting figures");
ok(/Florida/.test(STATE_ROSTER.countNote), "explains Florida is part of the disagreement");
ok(STATE_ROSTER.asOf === "2026-07", "roster is explicitly dated");
ok(/iapp\.org/.test(STATE_ROSTER.authoritativeSource), "points at the IAPP tracker as the maintained source");
ok(/not/.test(STATE_ROSTER.sourceNote), "admits our roster is not maintained");
ok(/legislative session/.test(STATE_PRIVACY_META.volatilityNote), "warns the landscape moves every session");

console.log("\nApplicability is NEVER determined — it's a legal question with fines:");
const ap = applicabilityPrompt({ personalDataCategories: { score: 100 }, dataSaleSharing: { score: 25 } });
ok(ap.determined === false, "determined: false");
ok(/do not determine/.test(ap.why), "explicitly says we don't determine applicability");
ok(/revenue|thresholds/.test(ap.why), "explains why — thresholds we don't collect");
ok(/counsel/.test(ap.whatToDo), "routes to counsel");
ok(ap.signals.some(s => s.level === "elevated"), "sensitive data + ad tech -> elevated signal");
const apNone = applicabilityPrompt({ personalDataCategories: { score: 0 } });
ok(apNone.signals.some(s => s.level === "low"), "no consumer data -> low signal");
ok(apNone.signals.some(s => /B2B|employee/.test(s.note)), "but still flags the B2B/employee-data trap");

console.log("\nEvidence mapping — the privacy intake actually feeds this:");
const qIds = new Set(SECURITY_CHECKLIST.map(q => q.id));
ok(STATE_PRIVACY_OBLIGATIONS.every(o => (o.evidence || []).length > 0), "every obligation has evidence");
const bad = STATE_PRIVACY_OBLIGATIONS.flatMap(o => (o.evidence || []).filter(e => !qIds.has(e)));
ok(bad.length === 0, `every evidence ID exists in the checklist${bad.length ? " — BROKEN: " + [...new Set(bad)] : ""}`);
const privacyQs = ["privacyNotice", "consumerRights", "dataSaleSharing", "personalDataCategories", "privacyRequestVolume"];
ok(privacyQs.every(q => STATE_PRIVACY_OBLIGATIONS.some(o => o.evidence.includes(q))),
   "every privacy intake question is used by at least one obligation");

console.log("\nScoring — the no-fabrication rules:");
const empty = assessStatePrivacy({});
ok(empty.summary.coveragePct === null, "empty assessment -> null, NOT 100%");
ok(empty.summary.unknown === 18, "empty -> all 18 'not yet assessed'");
const full = assessStatePrivacy(Object.fromEntries(SECURITY_CHECKLIST.map(q => [q.id, { score: 100 }])));
ok(full.summary.coveragePct === 100, "all-100 -> 100% of assessed obligations met");
ok(full.summary.unknown === 0, "all answered -> nothing unknown");

console.log("\nNo consumer data is not the same as compliant:");
const b2b = assessStatePrivacy({ personalDataCategories: { score: 0 } });
ok(b2b.noConsumerData === true, "flags noConsumerData rather than scoring it 100%");
ok(b2b.applicability.determined === false, "still refuses to determine applicability");

console.log("\nDivergent states are flagged, not averaged away:");
const states = STATE_ROSTER.notableVariations.map(v => v.state);
ok(states.includes("California"), "California — private right of action, dedicated agency");
ok(states.includes("Texas"), "Texas — no revenue threshold");
ok(states.includes("Maryland"), "Maryland — strictest minimisation");
ok(STATE_ROSTER.notableVariations.every(v => v.why && v.why.length > 20), "each variation explains itself");

console.log("\nThe obligations that catch SMBs out:");
const byId = Object.fromEntries(STATE_PRIVACY_OBLIGATIONS.map(o => [o.id, o]));
ok(/broadly/.test(byId["SP-6"].covers), "SP-6: 'sale' is broader than money changing hands");
ok(/ad-tech|advertising/.test(byId["SP-6"].covers), "SP-6: names ad tech as the trap");
ok(/service providers|vendors/.test(byId["SP-4"].covers), "SP-4: deletion must pass through to vendors");
ok(/sale/.test(byId["SP-15"].covers), "SP-15: missing contracts can turn a disclosure into a sale");
ok(byId["SP-14"].evidence.includes("encryptionAtRest"), "SP-14: reasonable security draws on real security answers");
ok(/private right of action/.test(byId["SP-14"].covers), "SP-14: names the liability hinge");

console.log("\nLegal posture:");
const r = assessStatePrivacy({ privacyNotice: { score: 45 } });
ok(r.legalReviewRequired === true, "legalReviewRequired flag set");
ok(/not legal advice/.test(r.disclaimer), "disclaimer: not legal advice");
ok(/not a determination/.test(r.disclaimer), "disclaimer: not a determination of applicability");
ok(/dated snapshot/.test(r.disclaimer), "disclaimer: roster is a dated snapshot");
ok(r.model === "common-obligation", "declares the common-obligation model");
ok(/not any single state/.test(r.modelNote), "explains we don't assess one state's statute");
ok(/computed|fixed rule/.test(r.methodology), "computed, not AI-interpreted");
ok(STATE_PRIVACY_META.publicDomain === true, "state statutes are public domain");

console.log("\nHelpers:");
ok(obligationsInArea("Consumer rights").length === 6, "obligationsInArea('Consumer rights') -> 6");
ok(obligationsInArea("Nope").length === 0, "unknown area -> empty, not a throw");

console.log(fail ? `\n${fail} FAILED` : "\nState Privacy verified");
process.exit(fail ? 1 : 0);
