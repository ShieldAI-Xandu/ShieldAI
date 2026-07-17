// pci.test.mjs — run: node pci.test.mjs
import { assessPciDss, suggestSaq, PCI_REQUIREMENTS, PCI_SAQ_TYPES, PCI_OBJECTIVES } from "./pciDss.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("Structure:");
ok(Object.keys(PCI_SAQ_TYPES).length === 9, "9 SAQ types");
ok(PCI_REQUIREMENTS.length === 12, "12 requirements");
ok(JSON.stringify(PCI_OBJECTIVES.flatMap(o => o.requirements)) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12]),
   "6 objectives cover requirements 1-12, none missing");

console.log("\nSAQ selection:");
const cases = [
  [{ channel: "ecommerce", ecommerceIntegration: "redirect" }, "A"],
  [{ channel: "ecommerce", ecommerceIntegration: "iframe" }, "A"],
  [{ channel: "ecommerce", ecommerceIntegration: "direct-post" }, "A_EP"],
  [{ channel: "ecommerce", ecommerceIntegration: "api" }, "D_MERCHANT"],
  [{ storesCardDataElectronically: true }, "D_MERCHANT"],
  [{ isServiceProvider: true }, "D_SERVICE"],
  [{ terminalType: "p2pe" }, "P2PE"],
  [{ terminalType: "dial-up" }, "B"],
  [{ terminalType: "ip-standalone" }, "B_IP"],
  [{ terminalType: "integrated-pos" }, "C"],
  [{ terminalType: "virtual-terminal" }, "C_VT"],
  [{}, "D_MERCHANT"],
];
for (const [input, expect] of cases) ok(suggestSaq(input).saq === expect, `${JSON.stringify(input)} -> ${expect}`);

console.log("\nConservatism (under-scoping PCI is the expensive error):");
ok(suggestSaq({}).confident === false, "unknown profile flagged not confident");
ok(suggestSaq({ terminalType: "virtual-terminal" }).confident === false, "C-VT not confident (dedicated-workstation condition)");

console.log("\nSAQ scoping actually reduces burden:");
const total = PCI_REQUIREMENTS.flatMap(r => r.subs).length;
const a = assessPciDss({}, { saq: "A" });
const dm = assessPciDss({}, { saq: "D_MERCHANT" });
const ds = assessPciDss({}, { saq: "D_SERVICE" });
ok(a.summary.subRequirementsInScope < 20, `SAQ A: ${a.summary.subRequirementsInScope} of ${total} in scope`);
ok(a.summary.scopedOut > 40, `SAQ A scopes out ${a.summary.scopedOut}`);
ok(dm.summary.scopedOut === 2, "D-Merchant excludes exactly 12.4 and 12.9 (service-provider-only)");
ok(ds.summary.scopedOut === 0, "D-Service: full standard, nothing scoped out");
ok(ds.summary.subRequirementsInScope > dm.summary.subRequirementsInScope, "service providers carry more than merchants");

console.log("\nv4.0.1 currency:");
const v = assessPciDss({ mfa: { score: 20 } }, { saq: "D_MERCHANT" });
ok(v.v4Gaps.length > 0, `${v.v4Gaps.length} v4.0 gaps surfaced separately`);
ok(/31 March 2025/.test(v.v4Note || ""), "warns the best-practice grace period ended");
ok(/v4\.0\.1/.test(v.framework.version), "version is v4.0.1, not v4.0");

console.log("\nHonesty:");
ok(/not a Self-Assessment Questionnaire/.test(a.disclaimer), "not an SAQ / AoC / RoC");
ok(/authoritative source is the SAQ document/.test(a.saqCaution), "defers to PCI SSC");
ok(/around 250 items/.test(a.granularityNote), "honest about granularity (we assess ~63 at sub-req level)");
ok(/not by an AI/.test(a.methodology), "computed, not AI-interpreted");
ok(a.summary.coveragePct === null, "empty assessment -> null, NOT 100%");
ok(/tokeniz/i.test(dm.scopeAdvice), "SAQ D advice points at scope reduction, not 250 controls");

console.log(fail ? `\n${fail} FAILED` : "\nPCI DSS verified");
process.exit(fail ? 1 : 0);
