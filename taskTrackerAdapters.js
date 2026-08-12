// taskTrackerAdapters.js
// Per-provider calls for Jira, Asana, and Trello: creating a ticket from a
// ShieldAI task and pulling its current status/priority back. Pull-based
// ("Sync status" button), not inbound webhooks — each provider signs
// webhooks differently (or, for Jira Cloud, not at all by default), which
// is real per-provider complexity for marginal benefit over a manual
// refresh — the exact same "Sync now" pattern directoryRoutes.js already
// uses for M365/Google Workspace/Okta. OAuth token exchange itself lives in
// taskTrackerRoutes.js (same split as directoryRoutes.js/directoryAdapters.js).
//
// Status mapping deliberately doesn't need a per-project custom-workflow
// mapping UI: Jira's statusCategory (new/indeterminate/done) is stable
// across any custom workflow a project uses; Asana tasks have a universal
// `completed` boolean; Trello has no universal status concept at all, so
// the client picks a specific "default list" and "done list" at connect
// time instead (same picker-at-connect-time pattern Slack's channel picker
// established) — moving a card between those two chosen lists IS the
// status signal.
//
// Priority: Jira has a real field, best-effort name-mapped below. Asana and
// Trello have no built-in priority field without a paid custom
// field/Power-Up — priority sync is simply omitted for those two rather
// than invented, consistent with this codebase's "real data over
// fabrication" rule.

// ── Jira Cloud (Atlassian OAuth 2.0 / 3LO) ──────────────────────────
export const JIRA_SCOPES = ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"];

async function jiraFetch(accessToken, cloudId, path, opts = {}) {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Jira API ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  return res.json();
}

// Atlassian OAuth tokens aren't scoped to one site at connect time — this
// resolves which Jira Cloud site(s) the authorizing user granted access to,
// and every other call needs the resulting cloudId.
export async function resolveJiraSites(accessToken) {
  const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Could not resolve Jira site: ${res.status}`);
  const sites = await res.json();
  return sites.map(s => ({ id: s.id, url: s.url, name: s.name }));
}

export async function fetchJiraProjects(accessToken, cloudId) {
  const data = await jiraFetch(accessToken, cloudId, "/rest/api/3/project/search?maxResults=100");
  return (data.values || []).map(p => ({ id: p.id, key: p.key, name: p.name }));
}

// Minimal Atlassian Document Format wrapper — a single paragraph node, not
// a full markdown-to-ADF converter. Jira Cloud's description field requires
// ADF, not plain text.
function adfParagraph(text) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: String(text || "(no detail provided)") }] }] };
}

export async function createJiraIssue(accessToken, cloudId, { projectKey, summary, description }) {
  const body = {
    fields: {
      project: { key: projectKey },
      summary: String(summary || "Untitled").slice(0, 255),
      description: adfParagraph(description),
      issuetype: { name: "Task" },
    },
  };
  const data = await jiraFetch(accessToken, cloudId, "/rest/api/3/issue", { method: "POST", body: JSON.stringify(body) });
  return { externalId: data.key, self: data.self };
}

const JIRA_PRIORITY_MAP = { Highest: "critical", High: "high", Medium: "medium", Low: "low", Lowest: "low" };

export async function fetchJiraStatus(accessToken, cloudId, issueKey) {
  const data = await jiraFetch(accessToken, cloudId, `/rest/api/3/issue/${issueKey}?fields=status,priority,summary`);
  const categoryKey = data.fields?.status?.statusCategory?.key; // "new" | "indeterminate" | "done" — stable across custom workflows
  const status = categoryKey === "done" ? "done" : categoryKey === "indeterminate" ? "in_progress" : "open";
  return {
    status,
    statusLabel: data.fields?.status?.name || null,
    priority: JIRA_PRIORITY_MAP[data.fields?.priority?.name] || null,
  };
}

// ── Asana ────────────────────────────────────────────────────────
export async function fetchAsanaWorkspaces(accessToken) {
  const res = await fetch("https://app.asana.com/api/1.0/workspaces", { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Asana workspaces failed: ${res.status} ${JSON.stringify(data)}`);
  return (data.data || []).map(w => ({ id: w.gid, name: w.name }));
}

export async function fetchAsanaProjects(accessToken, workspaceGid) {
  const url = new URL("https://app.asana.com/api/1.0/projects");
  url.searchParams.set("workspace", workspaceGid);
  url.searchParams.set("limit", "100");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Asana projects failed: ${res.status} ${JSON.stringify(data)}`);
  return (data.data || []).map(p => ({ id: p.gid, name: p.name }));
}

export async function createAsanaTask(accessToken, { workspaceGid, projectGid, name, notes }) {
  const res = await fetch("https://app.asana.com/api/1.0/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: { name: String(name || "Untitled").slice(0, 255), notes: String(notes || "").slice(0, 2000), projects: [projectGid], workspace: workspaceGid } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Asana create task failed: ${res.status} ${JSON.stringify(data)}`);
  return { externalId: data.data.gid, externalUrl: data.data.permalink_url || null };
}

export async function fetchAsanaStatus(accessToken, taskGid) {
  const url = new URL(`https://app.asana.com/api/1.0/tasks/${taskGid}`);
  url.searchParams.set("opt_fields", "completed,name");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(`Asana status failed: ${res.status} ${JSON.stringify(data)}`);
  return { status: data.data.completed ? "done" : "open", priority: null }; // no universal priority field without a paid custom field
}

// ── Trello ───────────────────────────────────────────────────────
// Paste-in API key + token, same pattern as Okta — Trello's primary
// integration model for this kind of use case isn't a redirect
// authorization-code flow.
function trelloUrl(path, { apiKey, token }, extraParams = {}) {
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  return url;
}

export async function fetchTrelloBoards(cred) {
  const res = await fetch(trelloUrl("/members/me/boards", cred, { fields: "name" }));
  if (!res.ok) throw new Error(`Trello boards failed: ${res.status}`);
  const data = await res.json();
  return data.map(b => ({ id: b.id, name: b.name }));
}

export async function fetchTrelloLists(cred, boardId) {
  const res = await fetch(trelloUrl(`/boards/${boardId}/lists`, cred, { fields: "name" }));
  if (!res.ok) throw new Error(`Trello lists failed: ${res.status}`);
  const data = await res.json();
  return data.map(l => ({ id: l.id, name: l.name }));
}

export async function createTrelloCard(cred, { listId, name, desc }) {
  const url = trelloUrl("/cards", cred, { idList: listId, name: String(name || "Untitled").slice(0, 255), desc: String(desc || "").slice(0, 2000) });
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Trello create card failed: ${res.status}`);
  const data = await res.json();
  return { externalId: data.id, externalUrl: data.shortUrl || data.url || null };
}

export async function fetchTrelloCard(cred, cardId) {
  const res = await fetch(trelloUrl(`/cards/${cardId}`, cred, { fields: "idList,name" }));
  if (!res.ok) throw new Error(`Trello card fetch failed: ${res.status}`);
  return res.json(); // { idList, name } — caller compares idList against the connection's configured doneListId
}

export async function validateTrelloCredential(cred) {
  const res = await fetch(trelloUrl("/members/me", cred, { fields: "username" }));
  return res.ok;
}
