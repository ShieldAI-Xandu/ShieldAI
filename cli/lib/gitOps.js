// cli/lib/gitOps.js
// Constrained git operations. Every call shells out via execFile with an
// argv array — never a shell string — so there's no injection surface.
//
// This is the actual enforcement point for "never push to main": the branch
// pushed is re-derived HERE from git itself in pushCurrentBranch(), never
// accepted as an argument. A protected or unprefixed branch is refused
// unconditionally, before any confirmation prompt even runs.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export const BRANCH_PREFIX = "shieldai-cli/";
const PROTECTED_BRANCHES = new Set(["main", "master"]);

async function git(args, cwd) {
  const { stdout } = await execFileP("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export async function status(cwd) {
  return git(["status", "--short"], cwd);
}

export async function diff(cwd) {
  return git(["diff"], cwd);
}

export async function diffStat(cwd) {
  return git(["diff", "--stat"], cwd);
}

export async function currentBranch(cwd) {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

export function slugifyBranchName(name) {
  const slug = String(name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60) || "fix";
  return `${BRANCH_PREFIX}${slug}`;
}

export async function createBranch(cwd, requestedName) {
  const branch = String(requestedName || "").startsWith(BRANCH_PREFIX)
    ? requestedName
    : slugifyBranchName(requestedName);
  if (PROTECTED_BRANCHES.has(branch)) {
    throw new Error(`Refusing to create/use protected branch "${branch}".`);
  }
  await git(["checkout", "-b", branch], cwd);
  return branch;
}

export async function addAll(cwd) {
  await git(["add", "-A"], cwd);
}

export async function commit(cwd, message) {
  await git(["commit", "-m", message], cwd);
}

export async function pushCurrentBranch(cwd) {
  const branch = await currentBranch(cwd);
  if (PROTECTED_BRANCHES.has(branch) || !branch.startsWith(BRANCH_PREFIX)) {
    throw new Error(
      `Refusing to push branch "${branch}" — only "${BRANCH_PREFIX}*" branches may be pushed by this tool.`
    );
  }
  await git(["push", "-u", "origin", branch], cwd);
  return branch;
}

// Used to hard-block git/GitHub activity attempted through the generic Bash
// tool — all of it must go through the git_*/github_* tools above instead,
// which is where the actual branch-protection and no-merge-tool guarantees
// live. Blocking only the literal word "git" is NOT enough: `curl -H
// "Authorization: token $(cat ~/.shieldai-cli/github-token)"
// https://api.github.com/repos/OWNER/REPO/contents/...` never contains
// that word (note \bgit\b deliberately does NOT match "github" — there's
// no word boundary between "git" and "hub" — so a naive "block the
// substring git" rule would itself refuse this on false grounds), yet it
// can write straight to main or drive a merge via the REST API using this
// CLI's own stored PAT, fully bypassing git_push's branch check and the
// fact that no github_merge_pr tool exists. Also blocks any reference to
// this CLI's own credential directory, so Bash can't read the session
// token or GitHub PAT into the model's context for use elsewhere (e.g.
// embedded in a file a later Write/Edit call stages for commit).
const BLOCKED_BASH_PATTERNS = [
  /\bgit\b/i,
  /\bgh\b/i,           // the standalone `gh` CLI — "gh pr merge" contains neither "git" nor "github"
  /github/i,           // github.com, api.github.com, gists, Actions, etc.
  /\.shieldai-cli\b/i, // this CLI's local session token / GitHub PAT storage
];

export function isGitCommand(bashCommand) {
  const cmd = String(bashCommand || "");
  return BLOCKED_BASH_PATTERNS.some(re => re.test(cmd));
}
