// cli/commands/github.js
// Issue/PR listing and code search — read-only GitHub access. PR creation
// itself lives in the coding agent's tool set (codingAgentTools.js), gated
// by confirmDangerous there; this command never writes to GitHub.
//
// GitHub Packages/container registry access is explicitly out of scope for
// v1 — nothing is published there today (no Dockerfile, npm is
// private:true, the one GH Actions workflow just commits a binary to
// main). Revisit if/when ShieldAI actually publishes something.

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRepoInfo, getOctokit, saveGithubToken, clearGithubToken, readGithubToken } from "../lib/githubClient.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../");

export async function runGithubLogin() {
  const rl = readline.createInterface({ input, output });
  const token = (await rl.question(
    "Paste a fine-grained GitHub PAT scoped to this repo (Contents/Pull requests/Issues: read+write, Metadata: read): "
  )).trim();
  rl.close();
  if (!token) {
    console.error("No token entered.");
    process.exitCode = 1;
    return;
  }
  saveGithubToken(token);
  console.log("GitHub token saved.");
}

export async function runGithubLogout() {
  clearGithubToken();
  console.log("GitHub token removed.");
}

export async function runGithubWhoami() {
  if (!readGithubToken()) {
    console.log("No GitHub token configured. Run `shieldai github login`.");
    return;
  }
  const octokit = getOctokit();
  const { data } = await octokit.rest.users.getAuthenticated();
  console.log(`GitHub: ${data.login}`);
}

export async function runGithubIssues({ state = "open" } = {}) {
  const octokit = getOctokit();
  const { owner, repo } = await getRepoInfo(REPO_ROOT);
  const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state, per_page: 30 });
  for (const issue of data.filter(i => !i.pull_request)) {
    console.log(`#${issue.number}  ${issue.title}`);
  }
}

export async function runGithubPrs({ state = "open" } = {}) {
  const octokit = getOctokit();
  const { owner, repo } = await getRepoInfo(REPO_ROOT);
  const { data } = await octokit.rest.pulls.list({ owner, repo, state, per_page: 30 });
  for (const pr of data) {
    console.log(`#${pr.number}  ${pr.title}  (${pr.head.ref} -> ${pr.base.ref})`);
  }
}

export async function runGithubSearchCode(query) {
  const octokit = getOctokit();
  const { owner, repo } = await getRepoInfo(REPO_ROOT);
  const { data } = await octokit.rest.search.code({ q: `${query} repo:${owner}/${repo}` });
  for (const item of data.items) {
    console.log(`${item.path}`);
  }
}
