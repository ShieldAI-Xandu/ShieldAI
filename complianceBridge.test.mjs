// complianceBridge.test.mjs — run: node complianceBridge.test.mjs
import {
  evaluateFramework, evaluateAllFrameworks, evaluateWithAgent,
  listFrameworkIds, getFrameworkDef, remediationContext,
  toRegistryId, toLegacyId, STATUS,
} from "./complianceBridge.js";
import { corroborate, disputes, corroborationSummary, AGENT_EVIDENCE_MAP } from "./agentEvidence.js";
import { toAssessOpts, visibleQuestions, intakeStatus, frameworksWithIntake, defaultsFor, intakeFor } from "./frameworkIntake.js";
import { SECURITY_CHECKLIST, toEvidence } from "./securityChecklist.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

const answers = {};
for (const q of SECURITY_CHECKLIST) answers[q.id] = q.options[1]?.label || q.options[0].label;

console.log("The merge — deep modules now drive the workspace:");
const depth = { "hipaa": 41, "soc2": 33, "pci-dss": 61, "iso-27001": 93, "nist-800-171": 110, "cmmc": 110, "nist-800-53": 149, "ftc-safeguards": 9, "state-privacy": 18 };
for (const [id, expected] of Object.entries(depth)) {
  const r = evaluateFramework(id, answers);
  ok(r && r.summary.total === expected, `${id}: ${r?.summary.total} controls (deep module, was ~10)`);
}
const total = Object.values(depth).reduce((a, b) => a + b, 0);
ok(total === 624, `${total} controls now reachable (legacy path had 57)`);

console.log("\nLegacy id compatibility — old bookmarks and stored records:");
ok(toRegistryId("hipaa") === "hipaa-security", "hipaa -> hipaa-security");
ok(toRegistryId("iso-27001") === "iso27001", "iso-27001 -> iso27001");
ok(toLegacyId("hipaa-security") === "hipaa", "reverse maps too");
ok(toRegistryId("soc2") === "soc2", "unmapped ids pass through");
ok(evaluateFramework("hipaa", answers) !== null, "legacy 'hipaa' still resolves");
ok(evaluateFramework("iso-27001", answers) !== null, "legacy 'iso-27001' still resolves");
ok(listFrameworkIds().includes("hipaa"), "list uses legacy ids for the UI");
ok(!listFrameworkIds().includes("hipaa-security"), "list doesn't leak registry ids");

console.log("\nNot-control-mapped frameworks report honestly:");
const gdpr = evaluateFramework("gdpr", answers);
ok(gdpr.notControlMapped === true, "GDPR flagged notControlMapped");
ok(gdpr.summary.total === 0 && gdpr.requirements.length === 0, "no fabricated control walkthrough");
ok(gdpr.summary.compliancePct === null, "null pct, not 0% — 'not assessed' != 'failing'");
ok(/interpretation/.test(gdpr.why), "explains it's the model's interpretation");

console.log("\nPercentages are over ASSESSED, never over total:");
const empty = evaluateFramework("iso-27001", {});
ok(empty.summary.compliancePct === null, "unanswered -> null, NOT 0%");
ok(empty.summary.unknown === 93, "unanswered -> all 93 unknown");
const partial = evaluateFramework("iso-27001", { mfa: "Yes, required on all accounts" });
ok(partial.summary.assessed < 93, "partial answers -> partial assessment");
ok(partial.summary.compliancePct !== 0 || partial.summary.compliant === 0, "pct reflects assessed only");

console.log("\nIntake scoping actually changes what's assessed:");
const saqA = toAssessOpts("pci-dss", { isServiceProvider: false, channel: "ecommerce", ecommerceIntegration: "redirect", storesCardDataElectronically: false });
const pciUnscoped = evaluateFramework("pci-dss", answers);
const pciScoped = evaluateFramework("pci-dss", answers, saqA);
ok(pciUnscoped.summary.total === 61, `unscoped PCI: 61 sub-requirements`);
ok(pciScoped.summary.total === 7, `SAQ A PCI: 7 sub-requirements (got ${pciScoped.summary.total})`);
ok(pciScoped.detail?.saq?.type === "A", "SAQ A correctly suggested from the intake");
ok(/acquiring bank|acquirer/i.test(intakeFor("pci-dss")?.suggestionNote || ""), "intake says the acquirer decides the SAQ, not us");

const isoRemote = toAssessOpts("iso27001", { hasSoA: false, excludePhysical: true, developsSoftware: false });
const isoScoped = evaluateFramework("iso-27001", answers, isoRemote);
ok(isoScoped.summary.total === 74, `remote/no-dev ISO: 74 in scope (got ${isoScoped.summary.total})`);
ok(isoScoped.excludedCount === 19, `19 controls excluded (got ${isoScoped.excludedCount})`);
ok(isoScoped.excluded.every(e => e.reason && e.reason.length > 10), "every exclusion carries a justification");
ok(isoScoped.excluded.some(e => /Statement of Applicability/.test(e.reason)), "exclusions point at the SoA");
ok(isoScoped.excluded.some(e => e.id === "A.7.1"), "physical controls excluded by real ID, not theme name");
ok(!isoScoped.excluded.some(e => e.id === "A.8.4"), "A.8.4 (source code access) NOT excluded — that would be a guess");

console.log("\nSOC 2 Security is force-included:");
const soc2Opts = toAssessOpts("soc2", { categories: ["availability"] });
ok(soc2Opts.categories.includes("security"), "deselecting Security still includes it — 'SOC 2 without Security' isn't a thing");

console.log("\nConditional intake questions:");
const ecomQs = visibleQuestions("pci-dss", { channel: "ecommerce" }).map(q => q.id);
const cardQs = visibleQuestions("pci-dss", { channel: "card-present" }).map(q => q.id);
ok(ecomQs.includes("ecommerceIntegration") && !ecomQs.includes("terminalType"), "e-commerce path skips terminal questions");
ok(cardQs.includes("terminalType") && !cardQs.includes("ecommerceIntegration"), "card-present path skips iframe questions");
ok(frameworksWithIntake().length === 6, `6 frameworks have scoping intake (got ${frameworksWithIntake().length})`);
const st = intakeStatus("pci-dss", { isServiceProvider: false });
ok(st.complete === false && st.missing.length > 0, "incomplete intake reports what's missing");
ok(/worst case/.test(st.defaultIfSkipped), "states what an unscoped assessment assumed");

console.log("\n── Agent evidence ──");
const mkReport = (hostname, overrides = {}) => ({
  host: { hostname, os: "windows" },
  checks: [
    { id: "disk_encryption", status: overrides.disk_encryption || "pass", observed: "BitLocker On" },
    { id: "firewall", status: overrides.firewall || "pass", observed: "all profiles enabled" },
    { id: "patches", status: overrides.patches || "pass", observed: "0 pending" },
    { id: "local_admins", status: overrides.local_admins || "pass", observed: "2 admin account(s)" },
  ],
});

console.log("\nConfirmation — measured evidence beats a checkbox:");
const claimsEncrypted = toEvidence({ ...answers, encryptionAtRest: "Full-disk encryption on laptops and servers" });
const allGood = corroborate([mkReport("PC1"), mkReport("PC2")], claimsEncrypted);
const enc = allGood.find(c => c.evidenceId === "encryptionAtRest");
ok(enc.status === "confirmed", "client says encrypted + agent agrees on all hosts -> confirmed");
ok(/measured evidence/.test(enc.note), "note frames it as measured, not self-assessed");
ok(enc.agent.hosts === 2 && enc.agent.unanimous === true, "reports host count and unanimity");

console.log("\nDispute — the most valuable output, not an error:");
const mixed = corroborate([mkReport("PC1"), mkReport("PC2", { disk_encryption: "fail" })], claimsEncrypted);
const d = mixed.find(c => c.evidenceId === "encryptionAtRest");
ok(d.status === "disputed", "client says encrypted, one host isn't -> disputed");
ok(/reconciling|reconcile|mixed/i.test(d.note), "note explains the discrepancy");
ok(d.clientAnswer === "Full-disk encryption on laptops and servers", "preserves what the client actually said");
ok(d.agent.fail === 1 && d.agent.pass === 1, "preserves what the agent actually saw");
ok(disputes([mkReport("PC1"), mkReport("PC2", { disk_encryption: "fail" })], claimsEncrypted).length >= 1, "disputes() surfaces it");

console.log("\nThe three rules hold:");
ok(allGood.every(c => c.authority === "informational"), "every record says the agent is informational only");
ok(allGood.every(c => /questionnaire answer decides/.test(c.authorityNote)), "and that the questionnaire decides");
ok(allGood.every(c => c.limits && c.limits.length > 20), "every mapping states its own limits");
ok(AGENT_EVIDENCE_MAP.every(m => m.scope === "endpoint" || m.scope === "endpoint-set"), "nothing claims org-wide scope");
const noAnswer = corroborate([mkReport("PC1")], {});
const na = noAnswer.find(c => c.evidenceId === "encryptionAtRest");
ok(na.status === "no-answer", "agent data alone does NOT answer the questionnaire");
ok(/does not answer it for you/.test(na.note), "explicitly refuses to promote telemetry to an answer");

console.log("\nCoverage is always stated:");
const sum = corroborationSummary([mkReport("PC1"), mkReport("PC2", { disk_encryption: "fail" })], claimsEncrypted);
ok(sum.reportingHosts === 2, "reports host count");
ok(sum.disputed >= 1 && sum.confirmed >= 1, "counts confirmations and disputes");
ok(/endpoint-observable/.test(sum.coverageNote), "coverage note names the limit");
ok(/read-only and permanently so/.test(sum.boundary), "restates the read-only boundary");
const none = corroborationSummary([], claimsEncrypted);
ok(none.reportingHosts === 0 && /self-reported/.test(none.coverageNote), "no agent -> says everything is self-reported");

console.log("\nevaluateWithAgent — annotation, never mutation:");
const plain = evaluateFramework("iso-27001", { ...answers, encryptionAtRest: "Full-disk encryption on laptops and servers" });
const withAgent = evaluateWithAgent("iso-27001", { ...answers, encryptionAtRest: "Full-disk encryption on laptops and servers" },
  [mkReport("PC1"), mkReport("PC2", { disk_encryption: "fail" })]);
ok(withAgent.summary.compliant === plain.summary.compliant, "agent data does NOT change a single control status");
ok(withAgent.summary.total === plain.summary.total, "agent data does not change scope");
ok(Array.isArray(withAgent.disputedRequirements), "disputes are surfaced separately for the analyst");
ok(withAgent.agent.reportingHosts === 2, "agent summary rides alongside");

console.log("\nRemediation context stays deterministic:");
const ctx = remediationContext("iso-27001", "A.5.1", answers);
ok(ctx !== null, "resolves a real ISO control");
ok(Array.isArray(ctx.controls) && ctx.controls.length > 0, "returns the answers driving it");
ok(ctx.controls.every(c => "requiredAnswer" in c), "states what answer would satisfy it");
ok(ctx.disclaimer !== undefined, "carries the module's disclaimer through");
ok(remediationContext("iso-27001", "NOPE", answers) === null, "unknown requirement -> null, not a guess");


console.log(fail ? `\n${fail} FAILED` : "\nCompliance bridge verified");
process.exit(fail ? 1 : 0);
