// cli/commands/requests.js
// Lists/shows/resolves analyst-submitted support requests — the escalation
// queue this CLI exists partly to triage. Uses the same allowlisted
// endpoints the "admin" command uses, not a new backend surface.

import { getLiveSession } from "../lib/session.js";
import { apiRequest } from "../lib/apiClient.js";
import { findOp } from "../lib/adminOpsAllowlist.js";
import { confirm } from "../lib/confirm.js";

export async function runRequestsList({ escalated } = {}) {
  const { token } = await getLiveSession();
  const op = findOp("support-requests-list");
  const list = await apiRequest(token, op.method, op.path({ escalated }));
  if (!list.length) {
    console.log(escalated ? "No escalated support requests." : "No support requests.");
    return;
  }
  for (const t of list) {
    const who = t.client?.name || "Internal";
    const esc = t.escalated ? " [ESCALATED]" : "";
    console.log(`${t.id}  ${t.status.padEnd(9)} ${who} — ${t.topic}${esc}`);
  }
}

export async function runRequestsShow(id) {
  const { token } = await getLiveSession();
  const op = findOp("support-requests-list");
  const list = await apiRequest(token, op.method, op.path({}));
  const ticket = list.find(t => t.id === id);
  if (!ticket) {
    console.error(`Support request ${id} not found (or not visible to this account).`);
    process.exitCode = 1;
    return;
  }
  console.log(`${ticket.topic} — ${ticket.status}${ticket.escalated ? " [ESCALATED]" : ""}`);
  console.log(`Client: ${ticket.client?.name || "(internal)"}`);
  for (const m of ticket.messages) {
    console.log(`\n[${m.authorLabel} — ${m.at}]\n${m.body}`);
  }
}

export async function runRequestsResolve(id) {
  const { token } = await getLiveSession();
  const op = findOp("support-request-resolve");
  const ok = await confirm({ message: op.confirmMessage({ id, status: "resolved" }) });
  if (!ok) {
    console.log("Declined — no request was made.");
    return;
  }
  const result = await apiRequest(token, op.method, op.path({ id }), op.body({ status: "resolved" }));
  console.log(`Support request ${result.id} marked resolved.`);
}
