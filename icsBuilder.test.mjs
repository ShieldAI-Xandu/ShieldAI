// icsBuilder.test.mjs — run: node icsBuilder.test.mjs
import { escapeIcsText, buildIcsFeed } from "./icsBuilder.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✖ ") + m); if (!c) fail++; };

console.log("escapeIcsText — RFC 5545 §3.3.11 TEXT escaping:");
ok(escapeIcsText("a,b") === "a\\,b", "comma escaped");
ok(escapeIcsText("a;b") === "a\\;b", "semicolon escaped");
ok(escapeIcsText("a\\b") === "a\\\\b", "backslash escaped");
ok(escapeIcsText("a\nb") === "a\\nb", "newline -> literal \\n");
ok(escapeIcsText("a\\,b") === "a\\\\\\,b", "backslash escaped before comma, not re-escaped by it");
ok(escapeIcsText(null) === "", "null -> empty string, no throw");

console.log("\nDTSTART/DTEND — all-day, DTEND exclusive:");
const oneItem = [{
  id: "custom:abc123", sourceType: "custom", title: "Renew cyber insurance",
  category: "insurance", dueDate: "2026-09-20T00:00:00.000Z", reviewStatus: "due_soon",
  notes: "", completedAt: null,
}];
const ics1 = buildIcsFeed(oneItem, { companyName: "Acme Co" });
ok(ics1.includes("DTSTART;VALUE=DATE:20260920"), "DTSTART is the due date");
ok(ics1.includes("DTEND;VALUE=DATE:20260921"), "DTEND is due date + 1 day (exclusive end)");
ok(ics1.includes("UID:custom:abc123@shieldai-compliance"), "UID reuses the item's own stable composite id");
ok(ics1.startsWith("BEGIN:VCALENDAR\r\n"), "starts with BEGIN:VCALENDAR, CRLF line endings");
ok(ics1.trimEnd().endsWith("END:VCALENDAR"), "ends with END:VCALENDAR");
ok(ics1.includes("METHOD:PUBLISH"), "declares itself a published feed, not interactive");
ok(!/^RRULE/m.test(ics1), "no RRULE — recurrence is a completion-driven roll-forward, not a calendar rule");

console.log("\nSkip rules:");
const skipItems = [
  { id: "a:1", title: "No date", category: "other", dueDate: null, reviewStatus: "not_set", completedAt: null },
  { id: "a:2", title: "Already done", category: "other", dueDate: "2026-01-01T00:00:00.000Z", reviewStatus: "current", completedAt: "2026-01-02T00:00:00.000Z" },
];
const icsSkip = buildIcsFeed(skipItems, { companyName: "Acme Co" });
ok(!icsSkip.includes("BEGIN:VEVENT"), "no-date and completed items produce zero VEVENTs");

console.log("\nLine folding — RFC 5545 §3.1, >75 octets wraps with CRLF + space:");
const longTitle = "A".repeat(120);
const icsLong = buildIcsFeed(
  [{ id: "custom:long", title: longTitle, category: "other", dueDate: "2026-09-20T00:00:00.000Z", reviewStatus: "current", completedAt: null }],
  { companyName: "Acme Co" },
);
const summaryLineStart = icsLong.split("\r\n").findIndex(l => l.startsWith("SUMMARY:"));
ok(summaryLineStart >= 0, "SUMMARY line present");
ok(icsLong.split("\r\n")[summaryLineStart + 1]?.startsWith(" "), "long SUMMARY folds onto a continuation line starting with a space");
// Every raw line (pre-join) should be <=75 octets before folding kicks in —
// verify no single physical line in the output exceeds that except where
// folding continuations legitimately restart the count.
const linesOut = icsLong.split("\r\n");
const tooLong = linesOut.filter(l => Buffer.byteLength(l, "utf8") > 75);
ok(tooLong.length === 0, "no output line exceeds 75 octets");

console.log("\nDescription composition:");
const icsDesc = buildIcsFeed(
  [{ id: "custom:d1", title: "T", category: "vendor", dueDate: "2026-09-20T00:00:00.000Z", reviewStatus: "overdue", notes: "Criticality: high", completedAt: null }],
  { companyName: "Acme Co" },
);
ok(icsDesc.includes("DESCRIPTION:Vendor — Overdue — Criticality: high"), "description joins category, status, and notes");

console.log(fail ? `\n${fail} FAILED` : "\nICS builder verified");
process.exit(fail ? 1 : 0);
