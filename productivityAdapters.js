// productivityAdapters.js
// Per-provider "do something in the productivity tool" calls — sending a
// notification, listing channels to pick from, confirming an interactive
// action. OAuth token exchange itself lives in productivityRoutes.js (same
// split as directoryRoutes.js/directoryAdapters.js: this file only holds
// calls made with an already-obtained token).

import { safeFetch } from "./outboundUrlSafety.js";

const SEVERITY_EMOJI = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };

// Slack mrkdwn requires escaping these three characters — unescaped, a
// title/detail containing "&", "<", or ">" would corrupt the message
// formatting (worst case, get interpreted as a broken link token).
function escapeSlackText(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendSlackMessage({ accessToken, channelId, title, detail, severity, actionable, refs }) {
  const emoji = SEVERITY_EMOJI[severity] || SEVERITY_EMOJI.info;
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${emoji} ${escapeSlackText(title)}*${detail ? `\n${escapeSlackText(detail)}` : ""}` } },
  ];
  if (actionable && refs?.refType && refs?.refId) {
    const encode = (action) => JSON.stringify({ refType: refs.refType, refId: refs.refId, action });
    blocks.push({
      type: "actions",
      block_id: "shieldai_actions",
      elements: [
        { type: "button", action_id: "shieldai_handle", text: { type: "plain_text", text: "I'll handle it" }, style: "primary", value: encode("handle") },
        { type: "button", action_id: "shieldai_complete", text: { type: "plain_text", text: "Mark done" }, value: encode("complete") },
        { type: "button", action_id: "shieldai_decline", text: { type: "plain_text", text: "Decline" }, style: "danger", value: encode("decline") },
      ],
    });
  }

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
    // `text` is Slack's required fallback string (notification previews, screen readers) — kept plain, blocks carry the real formatting.
    body: JSON.stringify({ channel: channelId, text: title, blocks }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack chat.postMessage failed: ${json.error}`);
  return json; // { ok, channel, ts, ... }
}

export async function fetchSlackChannels({ accessToken }) {
  const channels = [];
  let cursor;
  do {
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("types", "public_channel,private_channel");
    url.searchParams.set("exclude_archived", "true");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack conversations.list failed: ${json.error}`);
    // The bot only sees channels it's been invited to (or public ones, if
    // the channels:read scope alone was granted) — that's Slack's own
    // access model, not a filter ShieldAI applies.
    channels.push(...(json.channels || []).map(c => ({ id: c.id, name: c.name })));
    cursor = json.response_metadata?.next_cursor || null;
  } while (cursor);
  return channels;
}

// Updates the original message in place via the short-lived response_url
// Slack includes on every interactivity payload — this is how the button
// row gets replaced with a confirmation rather than staying clickable
// forever after the action's already been applied.
export async function respondToSlack({ responseUrl, text }) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ replace_original: true, text }),
  }).catch(() => {}); // best-effort — the action already applied in ShieldAI regardless
}

// ── Microsoft Teams ──────────────────────────────────────────────
// No OAuth: connecting Teams is "paste the webhook URL Teams (or its 2024+
// replacement, a Power Automate workflow) generates for a specific
// channel" — the URL itself is already bound to one channel, so unlike
// Slack there's no separate channel picker. Uses the Adaptive Card +
// `attachments` envelope Power Automate's "Post card in a channel" trigger
// expects, rather than the older MessageCard format some legacy Incoming
// Webhook connectors still accept — this is the forward-looking choice,
// but Microsoft's own migration here has been in flux, so verify against a
// real webhook URL before trusting the exact envelope shape blindly (same
// "verify against a live setup" caveat this codebase applies to every
// adapter built from docs rather than a tested live account).
//
// "Two-way" for Teams works differently than Slack: there's no inbound
// interactivity endpoint, since a bare webhook URL can't receive replies.
// Action buttons are Action.OpenUrl deep links back into ShieldAI
// (`?action=...&refType=...&refId=...`), handled by a page-load effect in
// the frontend that applies the action the same way Slack's interactivity
// handler does — "two-way" via a page load instead of a background POST.
function teamsDeepLink(action, refs) {
  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/?action=${encodeURIComponent(action)}&refType=${encodeURIComponent(refs.refType)}&refId=${encodeURIComponent(refs.refId)}`;
}

export async function sendTeamsMessage({ webhookUrl, title, detail, severity, actionable, refs }) {
  const emoji = SEVERITY_EMOJI[severity] || SEVERITY_EMOJI.info;
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      { type: "TextBlock", text: `${emoji} ${title}`, weight: "bolder", size: "medium", wrap: true },
      ...(detail ? [{ type: "TextBlock", text: detail, wrap: true, isSubtle: true }] : []),
    ],
  };
  if (actionable && refs?.refType && refs?.refId) {
    card.actions = [
      { type: "Action.OpenUrl", title: "I'll handle it", url: teamsDeepLink("handle", refs) },
      { type: "Action.OpenUrl", title: "Mark done", url: teamsDeepLink("complete", refs) },
      { type: "Action.OpenUrl", title: "Decline", url: teamsDeepLink("decline", refs) },
    ];
  }

  const res = await safeFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] }),
  });
  // Body truncated — this text can reach the client (as the connect-time
  // validation error) and shouldn't echo back an arbitrary amount of
  // whatever the target host returned.
  if (!res.ok) throw new Error(`Teams webhook POST failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return { ok: true };
}

export const PRODUCTIVITY_PROVIDERS = {
  slack: { send: sendSlackMessage },
  teams: { send: sendTeamsMessage },
};
