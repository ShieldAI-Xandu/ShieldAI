// kevService.test.mjs — run: node kevService.test.mjs
import { parseKevFeed, kevServiceStatus } from "./kevService.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("parseKevFeed — pure parsing, no network call:");
const fixture = {
  vulnerabilities: [
    {
      cveID: "CVE-2021-44228", vendorProject: "Apache", product: "Log4j2",
      vulnerabilityName: "Apache Log4j2 Remote Code Execution Vulnerability",
      dateAdded: "2021-12-10", shortDescription: "Log4j2 JNDI RCE.",
      requiredAction: "Apply updates per vendor instructions.",
      dueDate: "2021-12-24", knownRansomwareCampaignUse: "Known",
    },
    {
      cveID: "CVE-2022-99999", vendorProject: "Example", product: "Widget",
      vulnerabilityName: "Example Widget Vulnerability",
      dateAdded: "2022-01-01", shortDescription: "Example.",
      requiredAction: "Apply updates.", dueDate: "2022-01-15",
      knownRansomwareCampaignUse: "Unknown",
    },
    { /* malformed entry with no cveID — must not crash or produce a bogus key */ product: "NoId" },
  ],
};
const map = parseKevFeed(fixture);
ok(map.size === 2, "2 valid entries parsed, malformed entry skipped");
ok(map.get("CVE-2021-44228")?.knownRansomwareCampaignUse === true, "'Known' -> boolean true");
ok(map.get("CVE-2022-99999")?.knownRansomwareCampaignUse === false, "'Unknown' -> boolean false");
ok(map.get("CVE-2021-44228")?.dueDate === "2021-12-24", "dueDate carried through");
ok(map.get("CVE-2021-44228")?.cveId === "CVE-2021-44228", "cveId field set from cveID");
ok(parseKevFeed({}).size === 0, "missing vulnerabilities array -> empty map, no throw");
ok(parseKevFeed(null).size === 0, "null payload -> empty map, no throw");

console.log("\nkevServiceStatus — shape matches the house pattern (cveServiceStatus/darkwebServiceStatus):");
const status = kevServiceStatus();
for (const field of ["id", "name", "purpose", "configured", "required", "implemented", "impact", "degradesTo", "cacheEntries", "cacheTtlHours", "blockerText", "advisoryText"]) {
  ok(field in status, `has '${field}'`);
}
ok(status.id === "kev", "id is 'kev'");
ok(status.configured === true, "configured is always true — no key required");
ok(status.required === false, "never a hard requirement — enrichment only");
ok(status.blockerText === null, "KEV is never a blocker");

console.log(fail ? `\n${fail} FAILED` : "\nKEV service verified");
process.exit(fail ? 1 : 0);
