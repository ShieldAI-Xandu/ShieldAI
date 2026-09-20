// frameworkEntitlements.test.mjs — run: node frameworkEntitlements.test.mjs
import {
  frameworkAllowance, clampSelectedFrameworks, newEntitlement, assignEntitlement,
  unassignEntitlement, cancelEntitlement, paidFrameworkIds, entitlementCounts,
  findUnassignedEntitlement, hasFreeIncludedSlot, snapshotGrandfatheredFrameworks,
  normaliseSelection, monthlyCentsFor, pendingBillingEntitlements,
  FOUNDATION_FRAMEWORK_IDS, ENTITLING_STATUSES, FRAMEWORK_ADDON_ID,
} from "./frameworkEntitlements.js";
import { addonPriceLabel, canPurchaseAddon, TIER_ORDER, FEATURE_CATALOG } from "./tiers.js";
import { getFrameworkDef } from "./complianceBridge.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

// Minimal fakes. No lowdb, no Express, no supertest — the whole point of
// keeping this logic in a leaf module is that it needs none of them.
const CLIENT = "client-1";
const mkDb = ({ entitlements = [], grandfather = [], assessments = [] } = {}) => ({
  data: {
    frameworkEntitlements: entitlements,
    frameworkGrandfather: grandfather,
    assessments,
    users: [{ id: CLIENT, email: "c@example.com" }],
  },
});
const mkGate = tierId => ({ tierOf: () => tierId });
const mkAssessment = (ids, userId = CLIENT) => ({
  id: "a1", userId,
  data: { selectedFrameworks: ids.map(id => ({ id, name: id.toUpperCase() })) },
});

const FOUR = ["nist-csf", "cis", "hipaa", "soc2", "pci-dss", "iso-27001"];

console.log("The cap still caps:");
{
  const db = mkDb();
  const a = frameworkAllowance(db, mkGate("starter"), CLIENT, mkAssessment(FOUR));
  ok(a.limit === 2, `starter limit is 2 (got ${a.limit})`);
  ok(a.allowedIds.has("hipaa") && a.allowedIds.has("soc2"), "first 2 additional frameworks allowed");
  ok(!a.allowedIds.has("pci-dss") && !a.allowedIds.has("iso-27001"), "3rd and 4th blocked");
  ok(a.blockedIds.join(",") === "pci-dss,iso-27001", `blockedIds names them (${a.blockedIds.join(",")})`);
  ok(a.allowedIds.has("nist-csf") && a.allowedIds.has("cis"), "foundation frameworks always allowed");
  ok(a.included.used === 2 && a.included.limit === 2, "included usage reported as 2 of 2");
}

console.log("\nUnlimited and legacy records are left alone:");
{
  const db = mkDb();
  const a = frameworkAllowance(db, mkGate("managed"), CLIENT, mkAssessment(FOUR));
  ok(a.limit === null && a.unlimited === true, "managed is unlimited");
  ok(a.blockedIds.length === 0, "nothing blocked on managed");
  ok(FOUR.every(id => a.allowedIds.has(id)), "every selected framework allowed");

  // Pre-dates selectedFrameworks entirely — must not read as "selected none".
  const legacy = frameworkAllowance(db, mkGate("starter"), CLIENT, { id: "old", userId: CLIENT, data: {} });
  ok(legacy.selectedIds === null, "no selection recorded -> selectedIds null");
  ok(legacy.blockedIds.length === 0, "legacy assessment isn't retroactively capped");
}

console.log("\nFree tier gets zero additional frameworks:");
{
  const a = frameworkAllowance(mkDb(), mkGate("free"), CLIENT, mkAssessment(FOUR));
  ok(a.limit === 0, "free limit is 0");
  ok(a.blockedIds.length === 4, `all 4 additional blocked (got ${a.blockedIds.length})`);
  ok(a.allowedIds.has("nist-csf") && a.allowedIds.has("cis"), "foundation still allowed on free");
  ok(hasFreeIncludedSlot(a) === false, "no free slot to offer");
}

console.log("\nA paid slot does NOT evict an included one (the old slice did):");
{
  const paid = assignEntitlement(
    newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "iso-27001", frameworkName: "ISO 27001" },
  );
  const db = mkDb({ entitlements: [paid] });
  const a = frameworkAllowance(db, mkGate("starter"), CLIENT, mkAssessment(FOUR));
  ok(a.allowedIds.has("iso-27001"), "the purchased 4th framework is allowed");
  ok(a.allowedIds.has("hipaa") && a.allowedIds.has("soc2"), "both included frameworks STILL allowed");
  ok(a.blockedIds.join(",") === "pci-dss", `only the unpaid one is blocked (${a.blockedIds.join(",")})`);
  ok(a.included.used === 2, "the paid framework didn't consume an included slot");
  ok(paidFrameworkIds(db, CLIENT).join(",") === "iso-27001", "paidFrameworkIds reports it");
}

console.log("\npending_billing grants access; cancelled does not:");
{
  const pending = assignEntitlement(
    newEntitlement({ userId: CLIENT }),                       // defaults to pending_billing
    { frameworkId: "pci-dss", frameworkName: "PCI DSS" },
  );
  ok(pending.status === "pending_billing", "a new purchase starts pending_billing");
  ok(ENTITLING_STATUSES.has("pending_billing"), "pending_billing is an entitling status");
  const a = frameworkAllowance(mkDb({ entitlements: [pending] }), mkGate("starter"), CLIENT, mkAssessment(FOUR));
  ok(a.allowedIds.has("pci-dss"), "access granted before the invoice is paid");

  const dead = cancelEntitlement(assignEntitlement(
    newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "pci-dss", frameworkName: "PCI DSS" },
  ));
  ok(dead.status === "cancelled" && !!dead.cancelledAt, "cancel stamps the record");
  const b = frameworkAllowance(mkDb({ entitlements: [dead] }), mkGate("starter"), CLIENT, mkAssessment(FOUR));
  ok(!b.allowedIds.has("pci-dss"), "a cancelled slot grants nothing");
  ok(entitlementCounts(mkDb({ entitlements: [dead] }), CLIENT).total === 0, "cancelled isn't counted as live");
}

console.log("\nDrop the framework, keep the slot, re-apply free:");
{
  const rec = assignEntitlement(
    newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "iso-27001", frameworkName: "ISO 27001" },
  );
  const db = mkDb({ entitlements: [rec] });

  unassignEntitlement(rec);
  ok(rec.frameworkId === null, "unassign releases the framework");
  ok(rec.status === "active", "unassign does NOT cancel the billing status");
  ok(rec.previousFrameworkIds.includes("iso-27001"), "history records what it was applied to");
  ok(entitlementCounts(db, CLIENT).unassigned === 1, "counted as a live unassigned slot");
  ok(paidFrameworkIds(db, CLIENT).length === 0, "no longer grants access to the old framework");
  ok(findUnassignedEntitlement(db, CLIENT) === rec, "discoverable for reuse");

  assignEntitlement(rec, { frameworkId: "pci-dss", frameworkName: "PCI DSS" });
  ok(rec.frameworkId === "pci-dss", "re-applied to a different framework");
  ok(db.data.frameworkEntitlements.length === 1, "reuse did NOT create a second charge");
  ok(monthlyCentsFor(db, CLIENT) === 4999, `still billing exactly $49.99 (got ${monthlyCentsFor(db, CLIENT)})`);
}

console.log("\nGrandfathering: an amnesty, not a permanently bigger plan:");
{
  const assessments = [mkAssessment(["nist-csf", "cis", "hipaa", "soc2", "pci-dss", "iso-27001", "gdpr", "cmmc"])];
  const db = mkDb({ assessments });
  const captured = snapshotGrandfatheredFrameworks(db);
  ok(captured === 1, `captured 1 client (got ${captured})`);
  ok(db.data.frameworkGrandfather[0].frameworkIds.length === 6, "froze the 6 additional frameworks, not the foundation");
  ok(db.data.frameworkGrandfather[0].reason === "pre_enforcement_selection", "records a machine-readable reason");
  ok(snapshotGrandfatheredFrameworks(db) === 0, "re-running is a no-op (idempotent)");
  ok(db.data.frameworkGrandfather.length === 1, "no duplicate snapshot rows");

  const a = frameworkAllowance(db, mkGate("starter"), CLIENT, assessments[0]);
  ok(a.blockedIds.length === 0, "a legacy Starter keeps all 6 frameworks");
  ok(a.included.used === 6, "grandfathered frameworks consume the allowance");
  ok(hasFreeIncludedSlot(a) === false, "so they gain no free headroom on top");

  // Adding a 7th after the cutoff is a normal purchase.
  const grown = mkAssessment(["nist-csf", "cis", "hipaa", "soc2", "pci-dss", "iso-27001", "gdpr", "cmmc", "ftc-safeguards"]);
  const b = frameworkAllowance(db, mkGate("starter"), CLIENT, grown);
  ok(b.blockedIds.join(",") === "ftc-safeguards", `the new one is blocked (${b.blockedIds.join(",")})`);
}

console.log("\nDowngrade pauses access without destroying the selection:");
{
  const paid = assignEntitlement(
    newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "cmmc", frameworkName: "CMMC" },
  );
  const db = mkDb({ entitlements: [paid] });
  const eight = mkAssessment(["nist-csf", "cis", "hipaa", "soc2", "pci-dss", "iso-27001", "gdpr", "cmmc"]);

  const before = frameworkAllowance(db, mkGate("guided"), CLIENT, eight);
  ok(before.blockedIds.length === 0, "on Guided (10) nothing is blocked");

  const after = frameworkAllowance(db, mkGate("starter"), CLIENT, eight);
  ok(after.allowedIds.has("hipaa") && after.allowedIds.has("soc2"), "2 included survive the downgrade");
  ok(after.allowedIds.has("cmmc"), "the paid framework survives the downgrade");
  ok(after.blockedIds.length === 3, `the other 3 are paused (got ${after.blockedIds.length})`);
  ok(eight.data.selectedFrameworks.length === 8, "the selection itself is untouched — a re-upgrade restores it");
}

console.log("\nThe write-side clamp drops exactly the blocked ids:");
{
  const db = mkDb();
  const gate = mkGate("starter");
  const incoming = { companyName: "Acme", selectedFrameworks: FOUR.map(id => ({ id, name: id.toUpperCase() })) };
  const { data, dropped } = clampSelectedFrameworks(db, gate, { userId: CLIENT }, incoming);
  ok(data.selectedFrameworks.length === 4, `kept foundation + 2 included (got ${data.selectedFrameworks.length})`);
  ok(data.selectedFrameworks.some(f => f.id === "nist-csf"), "never drops foundation");
  ok(dropped.map(d => d.id).join(",") === "pci-dss,iso-27001", "reports exactly what it dropped");
  ok(dropped.every(d => /\$49\.99\/mo/.test(d.reason)), "each reason quotes the real price");
  ok(data.companyName === "Acme", "unrelated fields pass through untouched");

  const staff = clampSelectedFrameworks(db, gate, { userId: "a1", isAnalyst: true }, incoming);
  ok(staff.dropped.length === 0, "staff bypass the clamp entirely");
  ok(staff.data.selectedFrameworks.length === 6, "staff selection is left whole");

  const paid = assignEntitlement(newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "iso-27001", frameworkName: "ISO 27001" });
  const withPaid = clampSelectedFrameworks(mkDb({ entitlements: [paid] }), gate, { userId: CLIENT }, incoming);
  ok(withPaid.data.selectedFrameworks.some(f => f.id === "iso-27001"), "never drops a framework they paid for");

  const untouched = clampSelectedFrameworks(db, gate, { userId: CLIENT }, { checklist: { mfa: "Yes" } });
  ok(untouched.dropped.length === 0, "a save with no framework list is a no-op");
}

console.log("\nBoth historical selection shapes are understood:");
{
  ok(normaliseSelection(["HIPAA", "SOC 2"])[0].id === "HIPAA", "plain-string entries normalise");
  ok(normaliseSelection([{ id: "hipaa", name: "HIPAA" }])[0].name === "HIPAA", "object entries normalise");
  ok(normaliseSelection(undefined) === null, "absent selection stays null, not []");
  ok(normaliseSelection([{ name: "Custom Thing" }])[0].id === "Custom Thing", "a name-only entry still gets an id");
}

console.log("\nPricing and purchase rules:");
{
  ok(addonPriceLabel(FRAMEWORK_ADDON_ID) === "$49.99/mo",
     `price renders with cents, not rounded (got ${addonPriceLabel(FRAMEWORK_ADDON_ID)})`);
  ok(addonPriceLabel("training_delivery") === "$40/mo",
     `whole-dollar add-ons are unchanged (got ${addonPriceLabel("training_delivery")})`);
  ok(canPurchaseAddon("free", FRAMEWORK_ADDON_ID) === false, "free can't buy — it has no compliance editing");
  ok(["starter", "growth", "guided"].every(t => canPurchaseAddon(t, FRAMEWORK_ADDON_ID)), "starter/growth/guided can buy");
  ok(canPurchaseAddon("managed", FRAMEWORK_ADDON_ID) === false, "managed can't buy — already unlimited");
  ok(TIER_ORDER.every(t => typeof canPurchaseAddon(t, FRAMEWORK_ADDON_ID) === "boolean"), "every tier has a defined answer");
  ok(!FEATURE_CATALOG.some(f => f.addon === FRAMEWORK_ADDON_ID),
     "NOT in FEATURE_CATALOG — a countable slot isn't a boolean feature");
}

console.log("\nFoundation ids are real frameworks, not a stale guess:");
{
  for (const id of FOUNDATION_FRAMEWORK_IDS) {
    ok(!!getFrameworkDef(id), `${id} resolves in the registry`);
  }
  const pendingDb = mkDb({ entitlements: [
    assignEntitlement(newEntitlement({ userId: CLIENT }), { frameworkId: "gdpr", frameworkName: "GDPR" }),
    cancelEntitlement(newEntitlement({ userId: CLIENT })),
  ] });
  ok(pendingBillingEntitlements(pendingDb).length === 1, "the invoicing worklist shows only live uninvoiced slots");
}

console.log("\ncheckFrameworkAccess speaks for all four call sites:");
{
  // Imported from the routes module, but it's a pure function — the same one
  // the walkthrough, the submission packet and the public trust page all call.
  const { checkFrameworkAccess } = await import("./complianceRoutes.js");
  const def = id => ({ id, name: id, short: id.toUpperCase() });

  const db = mkDb();
  const gate = mkGate("starter");
  const a = mkAssessment(FOUR);

  ok(checkFrameworkAccess(db, gate, CLIENT, def("hipaa"), a).ok === true, "an included framework is allowed");
  ok(checkFrameworkAccess(db, gate, CLIENT, def("nist-csf"), a).ok === true, "foundation is always allowed");

  const over = checkFrameworkAccess(db, gate, CLIENT, def("pci-dss"), a);
  ok(over.status === 402, `past the cap -> 402 (got ${over.status})`);
  ok(over.body.code === "FRAMEWORK_ADDON_REQUIRED", "with the add-on code the modal branches on");
  ok(over.body.addon === "compliance_framework", "naming the add-on");
  ok(over.body.error.includes("49.99"), "quoting the real price");
  ok(over.body.capability === "complianceAccess", "old capability field kept so existing client branches still work");

  const notSelected = checkFrameworkAccess(db, gate, CLIENT, def("cmmc"), a);
  ok(notSelected.status === 403 && notSelected.body.code === "NOT_SELECTED",
     "a framework they never picked is 403 NOT_SELECTED, not a paywall");

  // Paying for something they haven't re-added deserves a better answer than
  // "you didn't select it".
  const paidDb = mkDb({ entitlements: [assignEntitlement(
    newEntitlement({ userId: CLIENT, status: "active" }),
    { frameworkId: "cmmc", frameworkName: "CMMC" })] });
  const entitled = checkFrameworkAccess(paidDb, gate, CLIENT, def("cmmc"), a);
  ok(entitled.body.code === "ENTITLED_NOT_SELECTED", "an entitled-but-unselected framework says so");
  ok(/active add-on/.test(entitled.body.error), "and tells them they're already paying for it");

  const legacy = checkFrameworkAccess(db, gate, CLIENT, def("gdpr"), { id: "x", userId: CLIENT, data: {} });
  ok(legacy.ok === true, "a legacy assessment with no selection isn't retroactively blocked");

  const spareDb = mkDb({ entitlements: [newEntitlement({ userId: CLIENT, status: "active" })] });
  const withSpare = checkFrameworkAccess(spareDb, gate, CLIENT, def("pci-dss"), a);
  ok(withSpare.body.unassignedEntitlements === 1, "reports a spare slot they could apply");
  ok(/no extra cost/.test(withSpare.body.error), "and offers it rather than selling a second one");
}

console.log(fail === 0 ? "\nFramework entitlements verified" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
