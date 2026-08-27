#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  printf 'usage: %s [OWNER/REPO|GITHUB_URL]\n' "$0" >&2
  exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
  printf 'error: GitHub CLI (gh) is not installed or is not on PATH\n' >&2
  exit 127
fi

repo_input="${1:-}"
if [[ -n "$repo_input" ]]; then
  repo="$(gh repo view "$repo_input" --json nameWithOwner --jq '.nameWithOwner')"
else
  repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
fi

if [[ -z "$repo" ]]; then
  printf 'error: could not resolve a GitHub repository\n' >&2
  exit 1
fi

gh api "repos/${repo}/commits?per_page=1" --jq \
  'if length == 0 then error("repository has no commits") else .[0] | {
    sha: .sha,
    shortSha: .sha[0:7],
    message: (.commit.message | split("\n")[0]),
    author: (.author.login // .commit.author.name // "unknown"),
    committedAt: .commit.committer.date,
    url: .html_url
  } end'
