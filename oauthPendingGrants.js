// oauthPendingGrants.js
// Shared "pending OAuth grant" store used by every OAuth-based connector
// (directory, Slack, task-tracker, scheduling) to close a confused-deputy
// vulnerability: previously, each /callback route attributed the resulting
// connection directly to whoever had called /start (recorded in that file's
// own in-memory oauthStates map), with nothing verifying that the SAME
// person completed the browser redirect back from the provider. Since this
// app is bearer-token-only with no cookie session, `/callback` can't tell
// who's looking at the browser that lands on it — only `state` says who
// asked, and `state` is trivially forwardable.
//
// Attack this closed: an attacker calls /start under their own account,
// gets back the real, genuine provider consent URL (e.g. an actual
// login.microsoftonline.com link), and sends that URL to a victim admin.
// The victim authenticates with the real provider and grants real
// permissions — the domain in their address bar is legitimate, so this is a
// highly convincing phish. Provider redirects back to ShieldAI's /callback
// with the attacker's `state`. Under the old flow, the resulting credential
// (an OAuth grant into the VICTIM's own M365/Google/Slack/Jira/Zoom tenant)
// got stored as the ATTACKER's own connection — readable, and for the
// scheduling family, writable, through the attacker's normal ShieldAI
// session.
//
// Fix: /callback no longer writes a connection. It exchanges the code,
// stashes the result here under a fresh single-use pendingId, and redirects
// the browser to the SPA with that id in the query string. The SPA then
// makes an AUTHENTICATED POST to a new .../oauth/finish endpoint with the
// pendingId — and it's THAT call's req.userId, not the original /start
// caller, that the connection gets attributed to. A victim who was only
// sent the raw provider consent link has no reason to ever call ShieldAI's
// authenticated /finish with their own session (they may not even have a
// ShieldAI account), so the pending grant simply expires unused. If the
// attacker calls /finish themselves, they only ever attribute to their OWN
// account whatever THEY themselves consented to — the victim's grant is
// never reachable.

import { randomUUID } from "crypto";

const TTL_MS = 10 * 60 * 1000;

// familyKey -> Map(pendingId -> { payload, createdAt })
const stores = new Map();

function storeFor(familyKey) {
  if (!stores.has(familyKey)) stores.set(familyKey, new Map());
  return stores.get(familyKey);
}

function sweep(familyKey) {
  const s = storeFor(familyKey);
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of s) if (entry.createdAt < cutoff) s.delete(id);
}

// `familyKey` namespaces by connector family ("directory", "productivity",
// "tasktracker", "scheduling") purely so an id collision across families is
// impossible even though randomUUID() already makes that vanishingly
// unlikely — cheap defense in depth, not load-bearing.
export function createPendingGrant(familyKey, payload) {
  sweep(familyKey);
  const id = randomUUID();
  storeFor(familyKey).set(id, { payload, createdAt: Date.now() });
  return id;
}

// Single-use: deletes on read regardless of outcome, so a pendingId can
// never be replayed even if the caller doesn't end up using the result.
export function consumePendingGrant(familyKey, pendingId) {
  sweep(familyKey);
  const s = storeFor(familyKey);
  const entry = s.get(pendingId);
  if (!entry) return null;
  s.delete(pendingId);
  return entry.payload;
}
