---
name: github-latest-commit
description: Fetch the newest commit for the current GitHub repository or a specified OWNER/REPO or GitHub URL with GitHub CLI. Use for read-only commit checks; do not use for pulling, merging, or changing remote state.
---

# GitHub Latest Commit

Use this skill to retrieve the latest commit from GitHub and stop. A successful
run is read-only: do not edit application files, pull, checkout, commit, or
otherwise change local or remote repository state.

## Workflow

1. Resolve the target. Use an explicitly supplied `OWNER/REPO` or GitHub URL
   when provided; otherwise use the repository containing the current working
   directory.
2. Run [scripts/fetch_latest_commit.sh](scripts/fetch_latest_commit.sh).
   Pass the target as its only argument when one was supplied.
3. Report the returned JSON, which contains the full SHA, short SHA, first-line
   commit message, author, commit timestamp, and GitHub URL. Do not paraphrase
   the SHA or claim a newer commit than the command returned.

## Error handling

If the command fails, inspect stderr and repair the smallest local cause, then
retry once. Examples include correcting target resolution from the local
`origin` remote or fixing a defect in this skill's helper script. Keep retries
bounded and do not edit unrelated repository code merely to make the lookup
pass.

Do not modify credentials, invent a token, disable verification, or silently
switch to another repository. For missing `gh`, unauthenticated access,
insufficient permissions, rate limits, network failures, or a repository with
no commits, report the exact actionable blocker and stop. Never report success
unless the helper exits successfully.

The helper is intentionally small and shell-based; read it only when a lookup
error needs diagnosis or repair.
