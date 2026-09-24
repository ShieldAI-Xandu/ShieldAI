// icsBuilder.js
// Builds an RFC 5545 (iCalendar) feed from the compliance calendar's unified
// item list — the format Google Calendar, Outlook, and Apple Calendar all
// accept for a "subscribe by URL" live feed, so a client adding this URL
// once keeps seeing current due dates without re-importing anything.
//
// This is a PUBLISH feed, not an interactive calendar: no RRULE. This app's
// own "recurrence" (a custom reminder's due date rolling forward when marked
// done, complianceCalendarRoutes.js's /complete route) is decided by an
// action the client takes, not a fixed rule a calendar app could compute on
// its own — a real RRULE would claim a recurrence pattern that doesn't
// match how the date actually moves. Instead every item gets a STABLE UID
// (its own composite "sourceType:rawId" calendar-item id), so re-fetching
// this feed updates the same event in the subscriber's calendar app in
// place when the date changes, rather than duplicating it.

const CRLF = "\r\n";

// RFC 5545 §3.3.11 TEXT escaping — applied to SUMMARY/DESCRIPTION/CATEGORIES.
// Order matters: backslash first, or the backslashes this function inserts
// for comma/semicolon/newline would themselves get re-escaped.
export function escapeIcsText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// RFC 5545 §3.1 line folding: any content line over 75 octets must be split
// with a CRLF followed by a single leading space, and the reader un-folds by
// stripping "CRLF + space". Titles/notes here can run past 200/1000 chars
// (complianceCalendarRoutes.js's own caps), so SUMMARY/DESCRIPTION routinely
// need this — skipping it isn't a style choice, unfolded long lines are a
// documented cause of strict parsers (Apple Calendar in particular) silently
// dropping or garbling an event.
const utf8Encoder = new TextEncoder();
function byteLength(s) { return utf8Encoder.encode(s).length; }

function foldLine(line) {
  const bytes = byteLength(line);
  if (bytes <= 75) return line;
  let out = "";
  let chunk = "";
  let chunkBytes = 0;
  for (const ch of line) {
    const chByteLen = byteLength(ch);
    // A continuation physical line is "CRLF + space + chunk" — the leading
    // space counts toward its own 75-octet limit, so continuation chunks get
    // a 74-byte budget. The very first chunk has no such prefix and keeps
    // the full 75.
    const limit = out ? 74 : 75;
    if (chunkBytes + chByteLen > limit) {
      out += (out ? CRLF + " " : "") + chunk;
      chunk = ch;
      chunkBytes = chByteLen;
    } else {
      chunk += ch;
      chunkBytes += chByteLen;
    }
  }
  if (chunk) out += (out ? CRLF + " " : "") + chunk;
  return out;
}

// Due dates are stored as UTC ISO timestamps but represent a CALENDAR DATE,
// not a moment in time — using local-time getters here would shift the date
// by a day depending on what timezone the Node process happens to run in
// (e.g. midnight UTC reads back as the previous evening in any US timezone).
// UTC getters keep the date stable regardless of server timezone.
function ymd(dateIso) {
  const d = new Date(dateIso);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// DTEND for an all-day event is EXCLUSIVE per RFC 5545 §3.6.1 — a one-day
// event on 2026-09-20 is DTSTART 20260920 / DTEND 20260921. Getting this
// wrong renders every event as zero-length in most calendar apps.
function ymdPlusOne(dateIso) {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function dtstampNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const CATEGORY_LABEL = {
  insurance: "Insurance", license: "License", audit: "Audit",
  contract: "Contract", regulatory: "Regulatory", other: "Other",
  vendor: "Vendor", policy: "Policy", training: "Training", task: "Task",
};
const STATUS_LABEL = { overdue: "Overdue", due_soon: "Due soon", current: "Upcoming", not_set: "No date set" };

/**
 * @param {Array} items - the compliance calendar's unified item list
 *   ({id, sourceType, title, category, dueDate, reviewStatus, notes,
 *   completedAt, ...}), as returned by complianceCalendarRoutes.js's
 *   buildCalendarItems().
 * @param {{companyName: string}} opts
 * @returns {string} RFC 5545 text, CRLF line endings.
 */
export function buildIcsFeed(items, { companyName } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ShieldAI//Compliance Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`ShieldAI vCISO Compliance — ${companyName || "Client"}`)}`,
    // Two different refresh-interval hints since calendar apps don't agree
    // on which one they honor (Apple leans REFRESH-INTERVAL, Google/Outlook
    // historically lean X-PUBLISHED-TTL) — both are no-ops where unsupported.
    "REFRESH-INTERVAL;VALUE=DURATION:P1D",
    "X-PUBLISHED-TTL:P1D",
  ];

  const dtstamp = dtstampNow();
  for (const item of items) {
    // Can't place an item with no date on a calendar, and nothing already
    // done needs to keep showing up on a live feed of what's coming due.
    if (!item.dueDate || item.completedAt) continue;

    const descriptionParts = [
      CATEGORY_LABEL[item.category] || item.category,
      STATUS_LABEL[item.reviewStatus] || item.reviewStatus,
    ];
    if (item.notes) descriptionParts.push(item.notes);

    lines.push(
      "BEGIN:VEVENT",
      // item.id is already the stable "sourceType:rawId" composite key this
      // whole feature keys everything by — reusing it as the UID (rather
      // than minting a new one) is what makes a changed due date update the
      // same event on refresh instead of creating a duplicate.
      `UID:${item.id}@shieldai-compliance`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(item.dueDate)}`,
      `DTEND;VALUE=DATE:${ymdPlusOne(item.dueDate)}`,
      `SUMMARY:${escapeIcsText(item.title)}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join(" — "))}`,
      `CATEGORIES:${escapeIcsText(CATEGORY_LABEL[item.category] || item.category)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
