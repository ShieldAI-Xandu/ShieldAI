// emailService.js
// ShieldAI outbound email — the first real email-sending capability in the
// product. Everything that currently needs to reach someone by email
// (learner training links, phishing simulation emails, eventually password
// resets) has so far been distributed out-of-band, by a human copying a
// link. This is the shared, provider-agnostic sender everything else builds on.
//
// SECURITY / ABUSE: this module can only send email ShieldAI itself
// constructs (phishing-simulation content, training assignment notices).
// It is never handed arbitrary caller-supplied HTML to relay, and every
// call site is expected to pass a fixed, reviewed template — this is not a
// general-purpose "send any email" endpoint.
//
// Graceful degradation, same pattern as billingRoutes.js: if no provider key
// is configured, the module still loads and every send attempt returns a
// clear "email not configured" result instead of crashing — so the app runs
// fine, with sending features returning a specific error, until you wire a key.
//
// PROVIDERS: EMAIL_PROVIDER=resend (default) or EMAIL_PROVIDER=mailgun, both
// implemented and verified against each vendor's actual API contract — not
// just one default with others aspirational. Every call site goes through
// sendEmail() below, so adding a third (Postmark/SES) later is a change in
// this one file only.
//
// SENDING DOMAIN — read this before wiring a key:
// Phishing-simulation email is sent from a ShieldAI-controlled domain with a
// realistic-but-clearly-distinct sender identity (e.g. "IT Help Desk
// <it-helpdesk@simulate.shieldai.io>"), NOT from the client's own domain.
// This is deliberate, not a limitation: spoofing a client's exact domain
// would require every client to authorize ShieldAI in their own SPF/DKIM
// records (a heavy per-client setup burden) and risks their real domain's
// sending reputation if a simulation email is ever misfiled as spam. Sending
// from a ShieldAI-controlled domain with good reputation, using a believable
// but distinguishable sender, is how commercial phishing-simulation tools
// handle this by default.
//
// Setup: see PHISHING_SIMULATION_SETUP.md.

const PROVIDER = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
const FROM_DOMAIN = process.env.EMAIL_FROM_DOMAIN || "simulate.shieldai.io";

let sendImpl = null;
let configured = false;

// ── Resend ───────────────────────────────────────────────────────
// POST https://api.resend.com/emails, Bearer token, JSON body.
// Verified directly against Resend's published API reference.
if (PROVIDER === "resend") {
  const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
  if (RESEND_API_KEY) {
    configured = true;
    sendImpl = async ({ to, from, subject, html, text, replyTo }) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from, to: [to], subject, html, text,
          reply_to: replyTo || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Resend API error (${res.status})`);
      return { id: data.id || null };
    };
    console.log("ShieldAI email: Resend configured.");
  } else {
    console.warn("ShieldAI email: EMAIL_PROVIDER=resend but RESEND_API_KEY is not set — sends return \"not configured\" until you set it.");
  }
}

// ── Mailgun ──────────────────────────────────────────────────────
// POST https://api.mailgun.net/v3/{domain}/messages (or api.eu.mailgun.net
// for EU-region accounts), HTTP Basic Auth (username "api", password = your
// API key), form-encoded body — NOT JSON, unlike Resend. Mailgun's sending
// domain is part of the URL path itself, not just implied by the From
// address, so it needs its own config; it defaults to EMAIL_FROM_DOMAIN
// since in the ordinary case they're the same domain, but MAILGUN_DOMAIN can
// override that if you ever want them to differ.
if (PROVIDER === "mailgun") {
  const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || "";
  const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || FROM_DOMAIN;
  const MAILGUN_REGION = (process.env.MAILGUN_REGION || "us").toLowerCase(); // "us" | "eu"
  const MAILGUN_BASE = MAILGUN_REGION === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  if (MAILGUN_API_KEY) {
    configured = true;
    sendImpl = async ({ to, from, subject, html, text, replyTo }) => {
      const body = new URLSearchParams();
      body.set("from", from);
      body.set("to", to);
      body.set("subject", subject);
      if (html) body.set("html", html);
      if (text) body.set("text", text);
      if (replyTo) body.set("h:Reply-To", replyTo); // Mailgun's convention for custom headers
      const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64");
      const res = await fetch(`${MAILGUN_BASE}/v3/${MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Mailgun API error (${res.status})`);
      return { id: data.id || null };
    };
    console.log(`ShieldAI email: Mailgun configured (${MAILGUN_REGION.toUpperCase()} region, domain ${MAILGUN_DOMAIN}).`);
  } else {
    console.warn("ShieldAI email: EMAIL_PROVIDER=mailgun but MAILGUN_API_KEY is not set — sends return \"not configured\" until you set it.");
  }
}

if (!["resend", "mailgun"].includes(PROVIDER)) {
  console.warn(`ShieldAI email: unknown EMAIL_PROVIDER "${PROVIDER}" — expected "resend" or "mailgun". Sends will return "not configured".`);
}

export function emailConfigured() {
  return configured;
}

/**
 * Send one email. Returns { ok: true, id } on success, or { ok: false, error }
 * — never throws, so a single failed send in a batch (e.g. a phishing
 * campaign going out to 40 learners) doesn't take down the rest of the batch.
 * Callers should check `.ok`, not wrap this in try/catch.
 */
export async function sendEmail({ to, subject, html, text, fromName, fromLocal, replyTo }) {
  if (!configured) {
    return { ok: false, error: `Email sending is not configured. Set up ${PROVIDER === "mailgun" ? "MAILGUN_API_KEY" : "RESEND_API_KEY"} in the server environment (EMAIL_PROVIDER=${PROVIDER}).` };
  }
  if (!to || !subject || (!html && !text)) {
    return { ok: false, error: "to, subject, and html or text are required." };
  }
  const from = `${fromName || "ShieldAI"} <${fromLocal || "notifications"}@${FROM_DOMAIN}>`;
  try {
    const result = await sendImpl({ to, from, subject, html, text, replyTo });
    return { ok: true, id: result.id };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Send a batch, sequentially with a small delay — simple and safe at
 * ShieldAI's current scale (dozens of learners per campaign, not thousands).
 * Returns per-recipient results so a campaign can report partial failures
 * rather than treating the whole send as one atomic pass/fail.
 */
export async function sendBatch(messages, { delayMs = 120 } = {}) {
  const results = [];
  for (const msg of messages) {
    results.push({ to: msg.to, ...(await sendEmail(msg)) });
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}
