// productivityAdapters.js
// Per-provider "do something in the productivity tool" calls — sending a
// notification, listing channels to pick from, confirming an interactive
// action. OAuth token exchange itself lives in productivityRoutes.js (same
// split as directoryRoutes.js/directoryAdapters.js: this file only holds
// calls made with an already-obtained token).
//
// Slack is the only provider implemented in this pass — see
// INTEGRATIONS_SETUP.md's roadmap for Teams/Jira/Asana/Trello/Zoom/Meet.

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

export const PRODUCTIVITY_PROVIDERS = {
  slack: { send: sendSlackMessage },
};
