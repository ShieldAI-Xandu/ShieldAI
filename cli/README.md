# ShieldAI vCISO admin CLI

A local command-line tool for ShieldAI vCISO admin-category and super-admin staff.
It gives Claude scoped access to fix code issues in this repo, plus a
read/guarded-write assistant over live admin data. **Analysts cannot use
this** — every privileged command re-checks the live server and refuses
anything that isn't `isAdmin === true`.

## Safety boundaries (read this before running `code`)

- **This tool can never push to `main`/`master`, and there is no tool that
  can merge a pull request.** Not "won't by default" — the code paths don't
  exist. `git_push` re-derives the checked-out branch itself (never accepts
  one from the model) and refuses anything outside the `shieldai-cli/*`
  prefix. There is no `github_merge_pr` tool at all.
- Every file edit, git commit, push, PR creation, and admin write action
  requires an explicit human confirmation in the terminal — pushes and PR
  creation require typing back a phrase, not just `y`.
- Git operations must go through the `git_status`/`git_diff`/
  `git_create_branch`/`git_add_commit`/`git_push` tools. The `code` agent's
  Bash access refuses any command containing `git`.
- Admin write actions (`admin accounts-suspend`, `admin accounts-role`) are
  **not** Claude-mediated — they're direct CLI flags, so the confirm prompt
  is an exact echo of the request, not an LLM's paraphrase.

## Setup

```
npm install          # from the repo root, once
npm run cli -- login # sign in with your ShieldAI vCISO admin account
```

This talks to `http://localhost:3001` by default. Point it at another
server with `SHIELDAI_CLI_SERVER_URL` (e.g. the Railway production URL).

The `code` and `ask` commands need `ANTHROPIC_API_KEY` set in **your own
shell's environment** — this is a separate export from anything in the
server's `.env`; the CLI never reads the repo's `.env`.

### GitHub access

```
npm run cli -- github login
```

Paste a **fine-grained personal access token** scoped to just this repo:
Contents (read/write), Pull requests (read/write), Issues (read/write),
Metadata (read). Do not grant the `packages` scope — GitHub Packages/
container registry access is intentionally not supported yet (nothing is
published there today; see below).

Mint your own token — don't share one between admins. It's stored at
`~/.shieldai-cli/github-token`, outside this repo, and never touches
Railway. See `SECRETS_RUNBOOK.md`'s "per-admin, not per-deployment" section.

## Commands

| Command | What it does |
|---|---|
| `login` / `logout` / `whoami` | Session management. `whoami` always re-checks the live server. |
| `ask "<question>"` | Read-only natural-language assistant over live admin data (accounts, audit log, system health). Cannot write anything. |
| `admin accounts-list` | List all accounts. |
| `admin accounts-suspend <id> [--unsuspend]` | Suspend/reactivate an account (confirm-gated). |
| `admin accounts-role <id> <role> <value>` | Set `role` (`admin`\|`analyst`\|`client`) and `value` (`true`\|`false`) (confirm-gated). |
| `admin audit` / `admin system-health` | Read-only. |
| `code "<issue description>" [--request <id>]` | Runs the coding agent. `--request` pre-fills the task from a support request. |
| `github login` / `logout` / `whoami` | Manage your personal PAT. |
| `github issues` / `github prs` / `github search <query>` | Read-only GitHub listings. |
| `requests list [--escalated]` | List analyst-submitted support requests — the escalation queue. |
| `requests show <id>` | Show a ticket's full thread. |
| `requests resolve <id>` | Mark a ticket resolved (confirm-gated). |

## What "escalated" requests are

Analysts can open a support request on a client's behalf (restricted to
clients they're actually assigned to) or escalate an existing/internal issue
up to admin/super-admin — see the "Support Requests" tab in the Admin/
Analyst console. `requests list --escalated` is the queue an admin actually
needs to triage; `code --request <id>` turns an escalated code issue
straight into a fix session.

## Not supported yet

**GitHub Packages / container registry access.** Nothing is published
anywhere today — no Dockerfile, `npm` is `private:true`, the only GitHub
Actions workflow just commits a macOS installer binary to `main`. Revisit if
ShieldAI vCISO ever starts publishing an npm package or a container image.

**Claude-mediated admin writes.** `admin accounts-suspend`/`accounts-role`
are direct flags on purpose — routing account suspension/role changes
through an LLM's interpretation of a natural-language request adds real
ambiguity risk to access-control actions. This can be extended later behind
its own explicit flag if needed.

**Account creation, tier changes, account repair.** Extend
`lib/adminOpsAllowlist.js` with a new entry to add one — that file is the
*only* dispatch path for admin actions; there's no generic "call any admin
path" escape hatch.
