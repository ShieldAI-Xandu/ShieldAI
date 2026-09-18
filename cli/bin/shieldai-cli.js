#!/usr/bin/env node
// cli/bin/shieldai-cli.js — commander entry point. See cli/README.md.

import { Command } from "commander";
import { runLogin } from "../commands/login.js";
import { runLogout } from "../commands/logout.js";
import { runWhoami } from "../commands/whoami.js";
import { runAsk } from "../commands/ask.js";
import { runAccountsList, runAccountsSuspend, runAccountsRole, runAudit, runSystemHealth } from "../commands/admin.js";
import { runCode } from "../commands/code.js";
import { runGithubLogin, runGithubLogout, runGithubWhoami, runGithubIssues, runGithubPrs, runGithubSearchCode } from "../commands/github.js";
import { runRequestsList, runRequestsShow, runRequestsResolve } from "../commands/requests.js";
import { SessionError } from "../lib/session.js";

const program = new Command();
program.name("shieldai").description("ShieldAI admin CLI — admin/super-admin staff only.");

program.command("login").description("Sign in with your ShieldAI admin account.").action(runLogin);
program.command("logout").description("Clear the local ShieldAI session.").action(runLogout);
program.command("whoami").description("Show the currently signed-in account (live check).").action(runWhoami);

program
  .command("ask <question...>")
  .description("Ask a read-only question about live admin data.")
  .action((question) => runAsk(question.join(" ")));

const admin = program.command("admin").description("Guarded admin actions (direct flags, confirm-gated).");
admin.command("accounts-list").description("List all accounts.").action(runAccountsList);
admin
  .command("accounts-suspend <id>")
  .description("Suspend an account.")
  .option("--unsuspend", "Reactivate instead of suspending.")
  .action((id, opts) => runAccountsSuspend(id, !opts.unsuspend));
admin
  .command("accounts-role <id> <role> <value>")
  .description("Set role=admin|analyst|client and value=true|false on an account.")
  .action((id, role, value) => runAccountsRole(id, role, value === "true"));
admin.command("audit").description("List recent admin audit log entries.").action(runAudit);
admin.command("system-health").description("Show AI-provider/system health.").action(runSystemHealth);

program
  .command("code [task...]")
  .description("Run the agentic coding assistant on a described issue.")
  .option("--request <id>", "Prefill the task from an existing support request.")
  .action((task, opts) => runCode(task ? task.join(" ") : "", { requestId: opts.request }));

const github = program.command("github").description("GitHub repo access (read-only listings + PR creation via `code`).");
github.command("login").description("Store your personal GitHub PAT.").action(runGithubLogin);
github.command("logout").description("Remove the stored GitHub PAT.").action(runGithubLogout);
github.command("whoami").description("Show the authenticated GitHub identity.").action(runGithubWhoami);
github
  .command("issues")
  .description("List repo issues.")
  .option("--state <state>", "open|closed|all", "open")
  .action((opts) => runGithubIssues({ state: opts.state }));
github
  .command("prs")
  .description("List repo pull requests.")
  .option("--state <state>", "open|closed|all", "open")
  .action((opts) => runGithubPrs({ state: opts.state }));
github.command("search <query>").description("Search code in this repo.").action(runGithubSearchCode);

const requests = program.command("requests").description("Analyst-submitted support requests (escalation queue).");
requests
  .command("list")
  .description("List support requests.")
  .option("--escalated", "Only escalated requests.")
  .action((opts) => runRequestsList({ escalated: !!opts.escalated }));
requests.command("show <id>").description("Show a support request's full thread.").action(runRequestsShow);
requests.command("resolve <id>").description("Mark a support request resolved.").action(runRequestsResolve);

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof SessionError) {
    console.error(err.message);
    process.exitCode = 1;
  } else {
    console.error(err.stack || err.message);
    process.exitCode = 1;
  }
}
