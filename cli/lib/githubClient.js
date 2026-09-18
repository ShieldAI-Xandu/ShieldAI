// cli/lib/githubClient.js
// Per-admin GitHub PAT storage + an Octokit client scoped to just this repo.
// Deliberately NOT a shared Railway secret: this runs on each admin's own
// machine, and a per-admin PAT keeps GitHub's own audit trail attributing
// commits/PRs to the real admin instead of a shared bot identity.

import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import { CONFIG_DIR, GITHUB_TOKEN_FILE } from "./config.js";

const execFileP = promisify(execFile);

export function readGithubToken() {
  try {
    return fs.readFileSync(GITHUB_TOKEN_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function saveGithubToken(token) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(GITHUB_TOKEN_FILE, `${token.trim()}\n`, { mode: 0o600 });
}

export function clearGithubToken() {
  try { fs.unlinkSync(GITHUB_TOKEN_FILE); } catch { /* already gone */ }
}

export async function getRepoInfo(cwd) {
  const { stdout } = await execFileP("git", ["remote", "get-url", "origin"], { cwd });
  const url = stdout.trim();
  const match = url.match(/github\.com[:/]+([^/]+)\/([^/.]+?)(\.git)?$/);
  if (!match) throw new Error(`Could not parse a GitHub owner/repo from remote "${url}".`);
  return { owner: match[1], repo: match[2] };
}

export function getOctokit() {
  const token = readGithubToken();
  if (!token) {
    throw new Error('No GitHub token configured. Run "shieldai github login" first.');
  }
  return new Octokit({ auth: token });
}
