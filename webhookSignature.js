// webhookSignature.js
// Shared HMAC verification for inbound webhooks that sign their payload
// (Slack's interactivity callback now; Asana/Trello-style providers later —
// see INTEGRATIONS_SETUP.md's productivity-integrations roadmap). Nothing
// like this existed anywhere in ShieldAI before — the only other verified
// webhook (Stripe, in billingRoutes.js) delegates entirely to the Stripe
// SDK's own constructEvent(), which doesn't help for a provider with no SDK.
//
// Always verify over the RAW request body, before any JSON/form parsing —
// re-serializing a parsed body will not reproduce the exact bytes the
// provider signed. Callers must mount express.raw() on the specific route
// (see productivityRoutes.js and billingRoutes.js's existing precedent).

import { createHmac, timingSafeEqual } from "crypto";

// `raw` must be a Buffer or string — the exact bytes/text that were signed,
// already assembled by the caller (e.g. Slack signs "v0:{timestamp}:{rawBody}",
// not the raw body alone — build that string before calling this).
// `expectedSignature` is the header value to check against, with `prefix`
// stripped if the provider includes one (e.g. Slack's "v0=").
export function verifyHmacSignature(raw, expectedSignature, secret, opts = {}) {
  const { algorithm = "sha256", encoding = "hex", prefix = "" } = opts;
  if (!expectedSignature || !secret) return false;

  const sig = String(expectedSignature).startsWith(prefix)
    ? String(expectedSignature).slice(prefix.length)
    : String(expectedSignature);

  const computed = createHmac(algorithm, secret).update(raw).digest(encoding);

  const a = Buffer.from(sig, encoding);
  const b = Buffer.from(computed, encoding);
  // timingSafeEqual throws on length mismatch rather than returning false —
  // an attacker-controlled signature header of the wrong length must not
  // crash the request, so guard the length first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Slack-specific helper: signs "v0:{timestamp}:{rawBody}" and prefixes with
// "v0=". Also rejects stale requests (default 5 min tolerance) — Slack's own
// docs call this out as required to prevent replay of a captured request.
export function verifySlackSignature({ rawBody, timestampHeader, signatureHeader, signingSecret, toleranceSeconds = 300 }) {
  if (!timestampHeader || !signatureHeader || !signingSecret) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestampHeader));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const base = `v0:${timestampHeader}:${rawBody}`;
  return verifyHmacSignature(base, signatureHeader, signingSecret, { algorithm: "sha256", encoding: "hex", prefix: "v0=" });
}
