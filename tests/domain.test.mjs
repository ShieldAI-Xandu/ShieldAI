// domain.test.mjs — run: DB_DIR=./testdata node domain.test.mjs
import db, { runInStore, PROD_STORE } from "../db.js";
import {
  addDomain, checkOwnership, setHibpStatus, getClientDomain, getDomainById,
  listClientDomains, adminQueue, normalizeDomain, isValidDomain, isPublicEmailDomain,
  clientView, isMonitorable, OWNERSHIP, HIBP_STATUS,
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
  try { await addDomain(db, "u2", "gmail.com"); ok(false, "should reject public email domain"); }
  catch (e) { ok(e.status === 400 && /public email provider/.test(e.message), "rejects gmail.com with a clear reason"); }
  try { await addDomain(db, "u1", "not a domain"); ok(false, "should reject junk"); }
  catch (e) { ok(e.status === 400, "rejects invalid input"); }

  const rec = await addDomain(db, "u1", "https://www.acme.com/");
  ok(rec.domain === "acme.com", "normalizes on submit");
  ok(rec.ownership === OWNERSHIP.PENDING, "starts unverified");
  ok(rec.hibpStatus === HIBP_STATUS.NOT_SUBMITTED, "starts not enrolled");
  ok(!!rec.verificationToken, "issues a verification token");

  console.log("\nDomain collision:");
  try { await addDomain(db, "u2", "acme.com"); ok(false, "should refuse duplicate"); }
  catch (e) { ok(e.status === 409, "refuses a domain registered to another account"); }

  console.log("\nTHE CRITICAL GATE — HIBP cannot go live before ownership:");
  try {
    await setHibpStatus(db, rec.id, HIBP_STATUS.VERIFIED);
    ok(false, "should NOT allow verified before ownership");
  } catch (e) {
    ok(e.status === 409 && /hasn't proved domain ownership/.test(e.message),
       "REFUSES to mark monitoring live before ownership is proved");
  }

  console.log("\nMonitorable requires BOTH gates:");
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: ownership pending");
  // simulate ownership pass
  rec.ownership = OWNERSHIP.VERIFIED; rec.ownershipVerifiedAt = new Date().toISOString();
  await db.write();
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: HIBP not enrolled yet");
  await setHibpStatus(db, rec.id, HIBP_STATUS.SUBMITTED, { note: "added to dashboard" });
  ok(!isMonitorable(getClientDomain(db, "u1")), "not monitorable: HIBP only submitted");
  await setHibpStatus(db, rec.id, HIBP_STATUS.VERIFIED);
  ok(isMonitorable(getClientDomain(db, "u1")), "monitorable ONLY when both gates green");

  // A client can register more than one domain (parent company + brands,
  // regional TLDs, ...) — each has its own independent ownership/HIBP
  // lifecycle. Adding a second domain must NOT touch the first one's gates;
  // there is no single "the domain" to reset anymore.
  console.log("\nA second domain has its own independent lifecycle:");
  const rec2 = await addDomain(db, "u1", "newco.com");
  ok(rec2.id !== rec.id, "second domain is a separate record");
  ok(listClientDomains(db, "u1").length === 2, "client now has two domains on file");
  ok(rec2.ownership === OWNERSHIP.PENDING && rec2.hibpStatus === HIBP_STATUS.NOT_SUBMITTED,
     "new domain starts fresh, unverified");
  const rec1Again = getDomainById(db, rec.id);
  ok(rec1Again.ownership === OWNERSHIP.VERIFIED && rec1Again.hibpStatus === HIBP_STATUS.VERIFIED,
     "adding a second domain leaves the first domain's gates untouched");
  ok(isMonitorable(rec1Again) && !isMonitorable(rec2), "each domain's monitorable state is tracked independently");

  console.log("\nClient view never implies false monitoring:");
  const v = clientView(rec2, { hibpConfigured: true });
  ok(v.monitored === false && v.state === "awaiting_ownership", "unverified domain reads as awaiting ownership");
  ok(!!v.instructions?.value?.startsWith("shieldai-domain-verification="), "gives the exact TXT value");
  const vNone = clientView(null, { hibpConfigured: true });
  ok(vNone.monitored === false && vNone.nextStep === "submit_domain", "no domain reads as 'add your domain'");
  const vOff = clientView(rec1Again, { hibpConfigured: false });
  ok(vOff.monitored === false && vOff.state === "service_inactive",
     "no API key reads as inactive, not clear, even for an otherwise fully-monitored domain");

  console.log("\nAdmin queue reflects each domain independently:");
  // Verify rec2's ownership too (without HIBP enrollment), so the two domains
  // land in different queue stages: rec1 already monitored, rec2 now ready
  // to enroll.
  rec2.ownership = OWNERSHIP.VERIFIED; rec2.ownershipVerifiedAt = new Date().toISOString();
  await db.write();
  const q = adminQueue(db);
  ok(q.counts.total === 2, "queue counts both domains");
  ok(q.counts.monitored === 1, "one domain fully monitored");
  ok(q.counts.readyToEnroll === 1, "the other is ready to enroll now that ownership passed");
  const row1 = q.domains.find(d => d.domain === "acme.com");
  const row2 = q.domains.find(d => d.domain === "newco.com");
  ok(row1.monitorable === true && row1.actionable === false, "acme.com: already monitored, nothing actionable");
  ok(row2.actionable === true && row2.monitorable === false, "newco.com: ownership verified, ready for HIBP enrollment");
  ok(row1.companyName === "Acme Inc" && row2.companyName === "Acme Inc", "both rows joined to the same company");
});

console.log(fail ? `\n${fail} FAILED` : "\nAll domain-workflow tests passed");
process.exit(fail ? 1 : 0);
