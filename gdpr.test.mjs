// gdpr.test.mjs — run: node gdpr.test.mjs
import {
  assessGdpr, GDPR_OBLIGATIONS, GDPR_AREAS, GDPR_META,
  applicabilityPrompt, obligationsInArea,
} from "./gdpr.js";
import { SECURITY_CHECKLIST } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const answered = {};
for (const q of SECURITY_CHECKLIST) answered[q.id] = { score: q.options[1]?.score ?? q.options[0].score };
const strong = {};
for (const q of SECURITY_CHECKLIST) {
  strong[q.id] = { score: [...q.options].sort((a, b) => b.score - a.score)[0].score };
}

console.log("Structure — 29 obligations across 7 areas:");
ok(GDPR_OBLIGATIONS.length === 29, `29 obligations (got ${GDPR_OBLIGATIONS.length})`);
ok(GDPR_AREAS.length === 7, `7 areas (got ${GDPR_AREAS.length})`);
ok(new Set(GDPR_OBLIGATIONS.map(o => o.id)).size === 29, "no duplicate obligation IDs");
ok(GDPR_OBLIGATIONS.every(o => /^GDPR-\d+$/.test(o.id)), "IDs follow the GDPR-n convention");
ok(GDPR_OBLIGATIONS.every(o => GDPR_AREAS.some(a => a.id === o.area)),
   "every obligation belongs to a declared area");
ok(GDPR_AREAS.every(a => obligationsInArea(a.id).length > 0), "no empty areas");

console.log("\nEvery obligation is traceable — no free-floating claims:");
ok(GDPR_OBLIGATIONS.every(o => /^Articles? /.test(o.citation)),
   "every obligation cites the Article it comes from");
ok(GDPR_OBLIGATIONS.every(o => Array.isArray(o.evidence) && o.evidence.length > 0),
   "every obligation maps to at least one assessment question");
const checklistIds = new Set(SECURITY_CHECKLIST.map(q => q.id));
const dangling = [...new Set(GDPR_OBLIGATIONS.flatMap(o => o.evidence))].filter(id => !checklistIds.has(id));
ok(dangling.length === 0, `every evidence id is a real checklist question (dangling: ${dangling.join(", ") || "none"})`);
ok(GDPR_OBLIGATIONS.every(o => o.covers && o.covers.length > 60),
   "every obligation says in our own words what it requires");

console.log("\nArticle 32's four named measures each get their own obligation:");
const security = obligationsInArea("Security");
ok(security.length === 4, `4 security obligations (got ${security.length})`);
ok(security.some(o => /32\(1\)\(a\)/.test(o.citation)), "32(1)(a) — encryption and pseudonymisation");
ok(security.some(o => /32\(1\)\(b\)/.test(o.citation)), "32(1)(b) — confidentiality, integrity, availability, resilience");
ok(security.some(o => /32\(1\)\(c\)/.test(o.citation)), "32(1)(c) — restore availability after an incident");
ok(security.some(o => /32\(1\)\(d\)/.test(o.citation)), "32(1)(d) — regularly test and evaluate");

console.log("\nApplicability is NEVER determined — Article 3 is a legal test:");
const out = assessGdpr(answered, { euDataSubjects: false });
ok(out.applicable === false, "confirmed no EU data subjects -> not assessed");
ok(out.summary === undefined, "no score at all, not a zero");
ok(/may not apply/i.test(out.applicabilityNote), "says 'may not apply', never 'does not apply'");
ok(/Article 3\(2\)/.test(out.confirmFirst), "points at the Article that actually decides it");
ok(/legal advice/i.test(out.disclaimer), "disclaims legal advice");

const prompt = applicabilityPrompt();
ok(/don't answer this|do not answer this/i.test(prompt.weDoNotDecide), "the prompt refuses to answer");
ok(prompt.whatDrivesIt.length >= 4, "lists what actually drives Article 3 scope");
ok(prompt.whatDrivesIt.some(s => /Article 3\(1\)/.test(s)), "covers establishment in the EU/EEA");
ok(prompt.whatDrivesIt.some(s => /Article 3\(2\)\(a\)/.test(s)), "covers offering goods or services");
ok(prompt.whatDrivesIt.some(s => /Article 3\(2\)\(b\)/.test(s)), "covers monitoring behaviour");
ok(/solicitor|DPO/.test(prompt.getAdvice), "sends them to someone qualified");

console.log("\nUnsure about scope -> assess anyway, the conservative direction:");
const unsure = assessGdpr(answered, {});
ok(unsure.applicable === true, "no answer on file -> still assessed");
ok(unsure.summary.total === 29, "the full obligation set");
ok(unsure.role === "assumed-controller", "role recorded as an assumption, not a fact");
ok(/conservative|expensive direction/i.test(unsure.roleNote), "says why it assumed the broader set");

console.log("\nController vs processor — excluded with a reason, never scored as gaps:");
const proc = assessGdpr(answered, { euDataSubjects: true, role: "processor" });
const na = proc.areas.flatMap(a => a.obligations).filter(o => o.status === "not-applicable");
ok(na.length === 3, `3 controller-only obligations excluded (got ${na.length})`);
ok(na.map(o => o.id).sort().join(",") === "GDPR-25,GDPR-6,GDPR-7", "Articles 13, 14 and 35 are the three");
ok(na.every(o => /controller/i.test(o.exclusionReason)), "each says why it's the controller's duty");
ok(proc.summary.notApplicable === 3, "the summary counts them separately from gaps");
ok(/28, 30\(2\), 32 and 33\(2\)/.test(proc.roleNote),
   "still names the Articles a processor carries in its own right");
const both = assessGdpr(answered, { euDataSubjects: true, role: "both" });
ok(both.areas.flatMap(a => a.obligations).every(o => o.status !== "not-applicable"),
   "'both' gets the full set");

console.log("\nThe B2B trap — statePrivacy.js vetoes here, GDPR must not:");
ok(/no B2B carve-out/i.test(unsure.b2bNote), "says plainly there is no B2B carve-out");
ok(/Article 4\(1\)/.test(unsure.b2bNote), "cites the definition that makes work contact data personal");
const b2b = assessGdpr({ ...answered, personalDataCategories: { score: 0 } }, {});
ok(b2b.applicable === true && b2b.summary.total === 29,
   "a B2B/no-consumer-data answer does not suppress the assessment");

console.log("\nScoring is over ASSESSED obligations, never over the total:");
const blank = assessGdpr({}, {});
ok(blank.summary.compliancePct === null, "nothing answered -> null, NOT 0%");
ok(blank.summary.unknown === 29, "all 29 reported as not yet assessed");
ok(blank.summary.assessed === 0, "nothing counted as assessed");
const good = assessGdpr(strong, {});
ok(good.summary.compliancePct === 100, `best answers -> 100% (got ${good.summary.compliancePct})`);
ok(good.summary.gaps === 0, "best answers -> no gaps");
ok(proc.summary.assessed + proc.summary.unknown + proc.summary.notApplicable === proc.summary.total,
   "the counts add up to the total");

console.log("\nHonesty about what GDPR compliance is:");
ok(/certified/i.test(GDPR_META.criticalNote), "says there's no such thing as GDPR certification");
ok(/Article 42/.test(GDPR_META.criticalNote), "names the Article people misread as certification");
ok(/4%/.test(GDPR_META.penalty) && /2%/.test(GDPR_META.penalty), "states both Article 83 penalty tiers");
ok(/Article 3\(2\)/.test(GDPR_META.whoMustComply), "is upfront about the extraterritorial reach");
ok(/eur-lex/.test(GDPR_META.url), "links the Official Journal text");
ok(GDPR_META.publicDomain === false && /2011\/833\/EU/.test(GDPR_META.reuseNote),
   "records the EUR-Lex reuse basis rather than assuming public domain");
ok(/not by an AI's interpretation/.test(unsure.methodology),
   "methodology states the mapping is fixed, not model-generated");
ok(/not legal advice/i.test(unsure.disclaimer), "the scored path disclaims legal advice too");

console.log(fail === 0 ? "\nGDPR module verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
