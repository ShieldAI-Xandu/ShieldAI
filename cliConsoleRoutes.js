// cliConsoleRoutes.js
// Web counterpart to the terminal admin CLI's read-only `ask` assistant
// (cli/commands/ask.js + cli/lib/claudeToolLoop.js). The terminal version
// runs a raw Anthropic tool-use loop directly against api.anthropic.com from
// the admin's own shell; this route runs the same 4-tool loop through the
// server's existing callClaudeWithTools() (server.js) instead, calling the
// same in-process data (adminUserView, adminAudit, system-health) that the
// admin REST routes already expose — no self-HTTP-call needed since this
// already runs inside the server.
//
// The Admin Ops and Requests panels in the web "CLI Console" tab need no new
// backend routes at all: they call the existing /api/admin/accounts*,
// /api/admin/audit, /api/admin/system-health, and /api/analyst/support-requests*
// routes directly, same as the rest of the admin UI already does.
//
// Mount from server.js:
//   registerCliConsoleRoutes(app, { db, requireAdmin, callClaudeWithTools, aiLimiter });

import { adminUserView } from "./adminRoutes.js";
import { getProviderHealth } from "./aiProviders.js";
import { getEmailHealth } from "./emailService.js";
import { serverErrorSummary } from "./healthMonitor.js";
import { sandboxStats } from "./db.js";

const ASK_TOOLS = [
  {
    name: "list_accounts",
    description: "List every account on the platform: id, email, category (superadmin/admin/analyst/client), tier, suspended flag, and endpoint/assessment/program/policy counts.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_account",
    description: "Get one account's full profile by id or email.",
    input_schema: { type: "object", properties: {
      idOrEmail: { type: "string", description: "The account's user id or email address." },
    }, required: ["idOrEmail"] },
  },
  {
    name: "list_audit",
    description: "List recent admin-audit-log entries (who did what, to which account, when), newest first. Optionally filter to one target account.",
    input_schema: { type: "object", properties: {
      targetUserId: { type: "string", description: "Optional: only entries for this account id." },
      limit: { type: "number", description: "Max entries to return (default 50, max 500)." },
    }, required: [] },
  },
  {
    name: "system_health",
    description: "Current system health snapshot: AI provider status, email health, recent server errors, demo sandbox stats.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

export function registerCliConsoleRoutes(app, { db, requireAdmin, callClaudeWithTools, aiLimiter }) {
  const findUser = (idOrEmail) => (db.data.users || []).find(
    u => u.id === idOrEmail || u.email.toLowerCase() === String(idOrEmail || "").toLowerCase()
  );

  async function runAskTool(name, input) {
    switch (name) {
      case "list_accounts":
        return (db.data.users || []).map(u => adminUserView(db, u));
      case "get_account": {
        const u = findUser(input?.idOrEmail);
        if (!u) return { error: "No account found for that id/email." };
        return adminUserView(db, u);
      }
      case "list_audit": {
        let rows = [...(db.data.adminAudit || [])];
        if (input?.targetUserId) rows = rows.filter(r => r.targetUserId === input.targetUserId);
        rows.sort((a, b) => new Date(b.at) - new Date(a.at));
        const limit = Math.min(Math.max(Number(input?.limit) || 50, 1), 500);
        return rows.slice(0, limit);
      }
      case "system_health":
        return {
          aiProviders: getProviderHealth(),
          email: getEmailHealth(),
          serverErrors: serverErrorSummary(),
          demoSandboxes: sandboxStats(),
          checkedAt: new Date().toISOString(),
        };
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  // Read-only natural-language assistant over live admin data — the web
  // equivalent of `npm run cli -- ask "<question>"`. Cannot write anything;
  // ASK_TOOLS only exposes reads.
  app.post("/api/admin/cli-console/ask", requireAdmin, aiLimiter, async (req, res) => {
    const question = String(req.body?.question || "").trim().slice(0, 2000);
    if (!question) return res.status(400).json({ error: "question is required." });
    try {
      const answer = await callClaudeWithTools({
        system: "You are a read-only assistant over ShieldAI vCISO's live admin data (accounts, audit log, system health) for admin/super-admin staff. Answer concisely and factually from the tools available. You cannot change anything — if asked to perform a write action, say so and point the operator at the Admin Ops panel or the terminal CLI's confirm-gated commands instead.",
        messages: [{ role: "user", content: question }],
        tools: ASK_TOOLS,
        runTool: runAskTool,
        max_tokens: 1200,
      });
      res.json({ answer });
    } catch (err) {
      console.error("CLI console ask error:", err.message);
      res.status(502).json({ error: "The assistant couldn't complete that request. Try again." });
    }
  });

  console.log("ShieldAI vCISO CLI console routes registered.");
}
