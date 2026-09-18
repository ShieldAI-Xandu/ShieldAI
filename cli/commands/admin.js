// cli/commands/admin.js
// Direct-flag guarded admin writes — deliberately NOT Claude-mediated, so
// the confirm prompt is an exact echo of the request, not an LLM's
// paraphrase, for access-control-adjacent actions like suspend/role change.

import { getLiveSession } from "../lib/session.js";
import { apiRequest } from "../lib/apiClient.js";
import { findOp } from "../lib/adminOpsAllowlist.js";
import { confirm } from "../lib/confirm.js";

async function runOp(opId, params) {
  const { token } = await getLiveSession();
  const op = findOp(opId);
  if (op.confirm) {
    const message = op.confirmMessage ? op.confirmMessage(params) : `Run ${op.method} ${op.path(params)}?`;
    const body = op.body ? op.body(params) : undefined;
    const ok = await confirm({
      message,
      detail: `${op.method} ${op.path(params)}${body ? `\n${JSON.stringify(body, null, 2)}` : ""}`,
    });
    if (!ok) {
      console.log("Declined — no request was made.");
      return;
    }
  }
  const body = op.body ? op.body(params) : undefined;
  const result = await apiRequest(token, op.method, op.path(params), body);
  console.log(JSON.stringify(result, null, 2));
}

export async function runAccountsList() {
  await runOp("accounts-list", {});
}

export async function runAccountsSuspend(id, suspended) {
  await runOp("account-suspend", { id, suspended });
}

export async function runAccountsRole(id, role, value) {
  await runOp("account-role", { id, role, value });
}

export async function runAudit() {
  await runOp("audit-list", {});
}

export async function runSystemHealth() {
  await runOp("system-health", {});
}
