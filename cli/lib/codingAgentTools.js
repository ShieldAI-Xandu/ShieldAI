// cli/lib/codingAgentTools.js
// The coding agent's tool set + the canUseTool permission dispatcher — this
// is where "AI advises, humans act" and "never push to main / never merge"
// are actually enforced, not just documented.
//
// Two layers of enforcement:
//  1. Absence: there is no github_merge_pr tool at all. Merging isn't
//     denied by a check — the code path doesn't exist.
//  2. Self-derivation: git_push takes no branch argument from the model.
//     gitOps.pushCurrentBranch() re-derives the checked-out branch itself
//     and refuses anything that isn't a "shieldai-cli/"-prefixed branch,
//     before this dispatcher even runs a confirmation prompt.
//
// Every tool call — built-in or custom — is gated here. Anything not
// explicitly listed in GATE defaults to "confirm", never to auto-allow.

import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import * as gitOps from "./gitOps.js";
import { getOctokit, getRepoInfo } from "./githubClient.js";
import { confirm, confirmDangerous } from "./confirm.js";

const SERVER_NAME = "shieldai";

function mcpName(name) {
  return `mcp__${SERVER_NAME}__${name}`;
}

export function buildShieldAiMcpServer(cwd) {
  const gitStatus = tool(
    "git_status",
    "Show the working tree status (read-only).",
    {},
    async () => {
      const out = await gitOps.status(cwd);
      return { content: [{ type: "text", text: out || "(clean)" }] };
    }
  );

  const gitDiff = tool(
    "git_diff",
    "Show the current unstaged/staged diff (read-only).",
    {},
    async () => {
      const out = await gitOps.diff(cwd);
      return { content: [{ type: "text", text: out || "(no diff)" }] };
    }
  );

  const gitCreateBranch = tool(
    "git_create_branch",
    "Create and check out a new branch for this fix. Give a short slug — " +
      "it is automatically prefixed with shieldai-cli/. Never main/master.",
    { name: z.string().min(1).describe("Short slug, e.g. 'fix-tier-gate-null-check'.") },
    async ({ name }) => {
      const branch = await gitOps.createBranch(cwd, name);
      return { content: [{ type: "text", text: `Checked out new branch: ${branch}` }] };
    }
  );

  const gitAddCommit = tool(
    "git_add_commit",
    "Stage all changes and commit them with the given message.",
    { message: z.string().min(1) },
    async ({ message }) => {
      await gitOps.addAll(cwd);
      await gitOps.commit(cwd, message);
      return { content: [{ type: "text", text: `Committed: ${message}` }] };
    }
  );

  const gitPush = tool(
    "git_push",
    "Push the current branch to origin. Takes no branch argument — the " +
      "branch actually checked out is always what gets pushed, and only a " +
      "shieldai-cli/* branch is ever accepted.",
    {},
    async () => {
      const branch = await gitOps.pushCurrentBranch(cwd);
      return { content: [{ type: "text", text: `Pushed ${branch} to origin.` }] };
    }
  );

  const githubOpenPr = tool(
    "github_open_pr",
    "Open a pull request from the current branch into main. There is no " +
      "tool to merge a PR — opening is as far as this can go.",
    { title: z.string().min(1), body: z.string().default("") },
    async ({ title, body }) => {
      const branch = await gitOps.currentBranch(cwd);
      const { owner, repo } = await getRepoInfo(cwd);
      const octokit = getOctokit();
      const { data } = await octokit.rest.pulls.create({ owner, repo, title, body, head: branch, base: "main" });
      return { content: [{ type: "text", text: `Opened PR #${data.number}: ${data.html_url}` }] };
    }
  );

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: "1.0.0",
    tools: [gitStatus, gitDiff, gitCreateBranch, gitAddCommit, gitPush, githubOpenPr],
  });
}

// none       -> auto-allow, no prompt (pure reads)
// confirm    -> ordinary y/N gate
// dangerous  -> confirmDangerous, typed-phrase gate (push, PR creation)
// Anything not listed here falls through to "confirm" by default — an
// unrecognized tool is gated, never silently auto-allowed.
const GATE = {
  Read: "none",
  Grep: "none",
  Glob: "none",
  TodoWrite: "none",
  Write: "confirm",
  Edit: "confirm",
  [mcpName("git_status")]: "none",
  [mcpName("git_diff")]: "none",
  [mcpName("git_create_branch")]: "confirm",
  [mcpName("git_add_commit")]: "confirm",
  [mcpName("git_push")]: "dangerous",
  [mcpName("github_open_pr")]: "dangerous",
};

function formatDetail(toolName, input) {
  if (toolName === "Write") {
    return `Write ${input.file_path}:\n\n${String(input.content ?? "").slice(0, 4000)}`;
  }
  if (toolName === "Edit") {
    return `Edit ${input.file_path}:\n\n--- old ---\n${input.old_string}\n\n--- new ---\n${input.new_string}`;
  }
  return JSON.stringify(input, null, 2);
}

export function createCanUseTool(cwd) {
  return async function canUseTool(toolName, input) {
    if (toolName === "Bash") {
      if (gitOps.isGitCommand(input?.command)) {
        return {
          behavior: "deny",
          message:
            "Git/GitHub operations and this CLI's own credential store are off-limits to Bash — use the " +
            "git_status/git_diff/git_create_branch/git_add_commit/git_push/github_open_pr tools instead.",
        };
      }
      const ok = await confirm({ message: "Run this Bash command?", detail: input?.command });
      return ok ? { behavior: "allow" } : { behavior: "deny", message: "Declined by operator." };
    }

    const rule = GATE[toolName] || "confirm";

    if (rule === "none") return { behavior: "allow" };

    if (rule === "dangerous") {
      if (toolName === mcpName("git_push")) {
        const branch = await gitOps.currentBranch(cwd).catch(() => null);
        const ok = await confirmDangerous({
          message: `Push branch "${branch}" to origin?`,
          requireTypedPhrase: branch || "PUSH",
        });
        return ok ? { behavior: "allow" } : { behavior: "deny", message: "Push declined by operator." };
      }
      if (toolName === mcpName("github_open_pr")) {
        const ok = await confirmDangerous({
          message: "Open a pull request?",
          detail: formatDetail(toolName, input),
          requireTypedPhrase: "OPEN PR",
        });
        return ok ? { behavior: "allow" } : { behavior: "deny", message: "PR creation declined by operator." };
      }
    }

    const ok = await confirm({ message: `Allow ${toolName}?`, detail: formatDetail(toolName, input) });
    return ok ? { behavior: "allow" } : { behavior: "deny", message: "Declined by operator." };
  };
}
