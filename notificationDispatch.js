// notificationDispatch.js
// Central "something happened, tell the client's team" dispatcher — the
// piece that didn't exist anywhere in ShieldAI before this. Every existing
// "send something" call site (policyAcknowledgmentRoutes.js's Remind,
// phishingRoutes.js's send) builds its own message inline and calls
// emailService.js's sendEmail() directly; there was nothing to subscribe
// to. This is that subscription point for productivity-tool channels
// (Slack and Microsoft Teams).
//
// Scope for this pass: EVENT-triggered notifications only — something that
// happens synchronously inside a request (a recommendation gets drafted, a
// task is completed, a phishing campaign finishes, a policy is assigned).
// There is no scheduler/cron anywhere in this codebase, so purely
// time-based nudges ("this task is now overdue") aren't covered here —
// that needs new polling infrastructure, deliberately out of scope.
//
// Call sites: agentRoutes.js's recommendation-forward path
// (recommendation.drafted — fires when a recommendation becomes VISIBLE TO
// THE CLIENT, i.e. status moves to "proposed", not when the AI first drafts
// it as "suggested". integrationRoutes.js/directoryRoutes.js's webhook and
// directory-sync findings land as "suggested" and sit in the analyst-only
// queue until an analyst reviews and forwards — notifying the client's own
// Slack at "suggested" time would leak an unreviewed AI draft straight past
// that review step, which is exactly the boundary
// "nothing reaches the client until an analyst does that" exists to
// prevent. Also: taskRoutes.js's /complete handler (task.completed),
// phishingRoutes.js's send-completion (phishing.campaign_sent — click
// results trickle in over subsequent days via a public no-auth link, which
// would need a scheduler to notify about later; only the synchronous
// "sending finished" moment is covered here), policyAcknowledgmentRoutes.js's
// assign handler (policy.signoff_pending).

import { decryptSecret } from "./credentialCrypto.js";
import { PRODUCTIVITY_PROVIDERS } from "./productivityAdapters.js";

export const NOTIFICATION_EVENTS = [
  { id: "recommendation.drafted", label: "New recommendation drafted" },
  { id: "task.completed", label: "Remediation task completed" },
  { id: "phishing.campaign_sent", label: "Phishing simulation sent" },
  { id: "policy.signoff_pending", label: "Policy assigned for sign-off" },
];
export const NOTIFICATION_EVENT_IDS = NOTIFICATION_EVENTS.map(e => e.id);

function ensureCollections(db) {
  db.data.productivityConnections ||= [];
}

// `refs` (optional): { refType: "recommendation"|"task", refId } — only
// needed when `actionable` is true, so an interactive button click (Slack's
// interactivity handler in productivityRoutes.js) knows what it's acting on.
export async function notify(db, { ownerUserId, event, title, detail, severity = "info", actionable = false, refs = null }) {
  ensureCollections(db);
  if (!NOTIFICATION_EVENT_IDS.includes(event)) return; // unknown event id — nothing subscribes to it, and nothing should silently "catch all"

  const channels = (db.data.productivityConnections || []).filter(c =>
    c.ownerUserId === ownerUserId && c.status === "active" &&
    Array.isArray(c.enabledEvents) && c.enabledEvents.includes(event)
  );
  if (channels.length === 0) return;

  let wrote = false;
  for (const conn of channels) {
    const adapter = PRODUCTIVITY_PROVIDERS[conn.provider];
    if (!adapter) continue;
    try {
      // The decrypted secret means different things per provider (Slack: a
      // bot access token; Teams: the webhook URL itself) — pass it under
      // both names and let each adapter's send() destructure the one it
      // actually uses, rather than branching on provider here.
      const secret = decryptSecret(conn.encryptedSecret);
      await adapter.send({ accessToken: secret, webhookUrl: secret, channelId: conn.channelId, title, detail, severity, actionable, refs });
      conn.lastNotifiedAt = new Date().toISOString();
      wrote = true;
    } catch (err) {
      // A channel outage or a revoked-but-not-yet-marked token must never
      // break the request that triggered this (drafting a recommendation,
      // completing a task, etc.) — log and move on to the next channel.
      console.warn(`Notification dispatch to ${conn.provider} (${conn.id}) failed:`, err.message);
    }
  }
  if (wrote) await db.write();
}
