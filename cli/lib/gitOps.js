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

// Used to hard-block git operations attempted through the generic Bash tool
// — all git activity must go through the functions above instead.
export function isGitCommand(bashCommand) {
  return /\bgit\b/i.test(String(bashCommand || ""));
}
