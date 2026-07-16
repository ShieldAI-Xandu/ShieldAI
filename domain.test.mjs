// domain.test.mjs — run: DB_DIR=./testdata node domain.test.mjs
import db, { runInStore, PROD_STORE } from "../db.js";
import {
  submitDomain, checkOwnership, setHibpStatus, getClientDomain, adminQueue,
  normalizeDomain, isValidDomain, isPublicEmailDomain, clientView, isMonitorable,
  OWNERSHIP, HIBP_STATUS,
} from "../domainService.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

await runInStore(PROD_STORE, async () => {
  db.data.users = [
    { id: "u1", email: "ceo@acme.com", companyName: "Acme Inc" },
    { id: "u2", email: "founder@gmail.com", companyName: "Solo LLC" },
  ];
  db.data.clientDomains = [];
  await db.write();

  console.log("Normalization:");
  ok(normalizeDomain("https://www.Acme.com/about?x=1") === "acme.com", "strips scheme/www/path/query, lowercases");
  ok(normalizeDomain("ACME.COM.") === "acme.com", "strips trailing dot");
  ok(normalizeDomain("acme.com:8443") === "acme.com", "strips port");

  console.log("\nValidation:");
  ok(isValidDomain("acme.com"), "accepts a real domain");
  ok(!isValidDomain("192.168.1.1"), "rejects an IP");
  ok(!isValidDomain("localhost"), "rejects localhost");
  ok(!isValidDomain("nodots"), "rejects bare hostname");
  ok(isPublicEmailDomain("gmail.com"), "flags gmail as public");

  console.log("\nSubmission guards:");
  try { await submitDomain(db, "u2", "gmail.com"); ok(false, "should reject public email domain"); }
  catch (e) { ok(e.status === 400 && /public email provider/.test(e.message), "rejects gmail.com with a clear reason"); }
  try { await submitDomain(db, "u1", "not a domain"); ok(false, "should reject junk"); }
  catch (e) { ok(e.status === 400, "rejects invalid input"); }

  const rec = await submitDomain(db, "u1", "https://www.acme.com/");
  ok(rec.domain === "acme.com", "normalizes on submit");
  ok(rec.ownership === OWNERSHIP.PENDING, "starts unverified");
  ok(rec.hibpStatus === HIBP_STATUS.NOT_SUBMITTED, "starts not enrolled");
  ok(!!rec.verificationToken, "issues a verification token");

  console.log("\nDomain collision:");
  try { await submitDomain(db, "u2", "acme.com"); ok(false, "should refuse duplicate"); }
  catch (e) { ok(e.status === 409, "refuses a domain registered to another account"); }

  console.log("\nTHE CRITICAL GATE — HIBP cannot go live before ownership:");
  try {
    await setHibpStatus(db, "u1", HIBP_STATUS.VERIFIED);
    ok(false, "should NOT allow verified before ownership");
  } catch (e) {
    ok(e.status === 409 && /hasn't proved domain ownership/.test(e.message),
       "REFUSES to mark monitoring live before ownership is proved");
  }

  console.log("\nMonitorable requires BOTH gates:");
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: ownership pending");
  // simulate ownership pass
  const r = getClientDomain(db, "u1");
  r.ownership = OWNERSHIP.VERIFIED; r.ownershipVerifiedAt = new Date().toISOString();
  await db.write();
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: HIBP not enrolled yet");
  await setHibpStatus(db, "u1", HIBP_STATUS.SUBMITTED, { note: "added to dashboard" });
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: HIBP only submitted");
  await setHibpStatus(db, "u1", HIBP_STATUS.VERIFIED);
  ok(isMonitorable(getClientDomain(db, "u1")), "monitorable ONLY when both gates green");

  console.log("\nChanging domain resets both gates:");
  await submitDomain(db, "u1", "newco.com");
  const after = getClientDomain(db, "u1");
  ok(after.ownership === OWNERSHIP.PENDING, "ownership reset on domain change");
  ok(after.hibpStatus === HIBP_STATUS.NOT_SUBMITTED, "HIBP status reset on domain change");
  ok(!isMonitorable(after), "no longer monitorable after change");

  console.log("\nClient view never implies false monitoring:");
  const v = clientView(after, { hibpConfigured: true });
  ok(v.monitored === false && v.state === "awaiting_ownership", "unverified reads as awaiting ownership");
  ok(!!v.instructions?.value?.startsWith("shieldai-domain-verification="), "gives the exact TXT value");
  const vNone = clientView(null, { hibpConfigured: true });
  ok(vNone.monitored === false && vNone.nextStep === "submit_domain", "no domain reads as 'add your domain'");
  after.ownership = OWNERSHIP.VERIFIED; await db.write();
  const vOff = clientView(after, { hibpConfigured: false });
  ok(vOff.monitored === false && vOff.state === "service_inactive", "no API key reads as inactive, not clear");

  console.log("\nAdmin queue prioritization:");
  const q = adminQueue(db);
  ok(q.counts.total === 1, "queue counts domains");
  ok(q.domains[0].actionable === true, "flags ready-to-enroll as actionable");
  ok(q.domains[0].companyName === "Acme Inc", "joins company name for the admin");
});

console.log(fail ? `\n${fail} FAILED` : "\nAll domain-workflow tests passed");
process.exit(fail ? 1 : 0);
