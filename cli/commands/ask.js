// cli/commands/ask.js
// Read-only natural-language assistant over live admin data. Every tool
// Claude can call here is one of the read-only entries in
// adminOpsAllowlist.js — there is no write capability reachable from this
// command at all.

import { getLiveSession } from "../lib/session.js";
import { apiRequest } from "../lib/apiClient.js";
import { findOp } from "../lib/adminOpsAllowlist.js";
import { callClaudeWithTools } from "../lib/claudeToolLoop.js";

const READ_TOOLS = [
  {
    name: "list_accounts",
    description: "List all ShieldAI accounts (clients, analysts, admins) with their tier/status.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_account",
    description: "Get full detail for one account by id.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "list_audit",
    description: "List recent admin audit log entries.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "system_health",
    description: "Get current AI-provider/system health status.",
    input_schema: { type: "object", properties: {} },
  },
];

const OP_BY_TOOL = {
  list_accounts: "accounts-list",
  get_account: "account-get",
  list_audit: "audit-list",
  system_health: "system-health",
};

export async function runAsk(question) {
  const { token, user } = await getLiveSession();

  async function runTool(name, input) {
    const opId = OP_BY_TOOL[name];
    if (!opId) throw new Error(`Unknown tool "${name}".`);
    const op = findOp(opId);
    return apiRequest(token, op.method, op.path(input));
  }

  const answer = await callClaudeWithTools({
    system:
      `You are a read-only assistant for a ShieldAI admin (${user.email}). ` +
      "Use the provided tools to look up live account/audit/health data before answering. " +
      "You have no write access — never claim to have changed anything.",
    messages: [{ role: "user", content: question }],
    tools: READ_TOOLS,
    runTool,
  });

  console.log(answer);
}
