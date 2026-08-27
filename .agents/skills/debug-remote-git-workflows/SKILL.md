---
name: debug-remote-git-workflows
description: Fetch a GitHub Actions workflow run for the repository's latest commit, retrieve actionable failure evidence, and repair failures locally without pushing or rerunning remote CI.
---

# Debug Remote Git Workflows

Use this skill when a repository has a GitHub Actions workflow that should be
checked against its latest repository commit and any actionable failures should
be fixed for review. The default workflow is `.github/workflows/ci.yml`.

## Fetch the exact run

Start in the repository root and preserve unrelated worktree changes. Read the
root `README.md`, `AGENTS.md`, the target workflow, and the source/test owners
of any failing step before editing.

Run the bundled helper:

```sh
.agents/skills/debug-remote-git-workflows/scripts/fetch-workflow-failure.sh \
  --workflow .github/workflows/ci.yml
```

The helper resolves the GitHub repository from the checkout, targets the latest
commit on that repository's default branch, selects the newest run for that
exact SHA, prints its status and job summary, and prints failed-step logs only
when the completed conclusion is failure-like. Use `--repo OWNER/REPO`,
`--commit SHA`, or `--output-dir DIR` only when the task requires an explicit
override or persistent evidence. The default does not create files.

Before editing, compare the target SHA with the checkout. If the target is not
the current `HEAD` or an ancestor of it, treat the result as diagnostics only
unless the user explicitly supplies a matching checkout; never patch a
different revision by inference.

If there is no run for the SHA, the run is queued/in progress, or the completed
run is successful, neutral, or skipped, report that state and make no source
changes. A canceled or action-required run is not proof of a code defect; do
not invent a fix. If fetching fails because GitHub CLI access, repository
resolution, or authentication is unavailable, report the exact blocker.

## Repair a failed run

For a completed failure, inspect every failed job and its logs, then trace each
failure to the owning workflow, script, source, fixture, dependency, or test.
Fix only actionable defects represented by the current checkout and preserve
unrelated changes. Do not weaken assertions, skip jobs, broaden permissions,
hide errors, add credentials, or make network/retry behavior unbounded.

After each focused repair, run the narrowest local regression checks and then
the complete relevant workflow gate. For this repository, that normally means
the commands represented by `.github/workflows/ci.yml`; use the repository
wrapper for Compose checks. Distinguish local proof from GitHub proof: do not
claim the remote run is fixed until a separately authorized remote run confirms
it.

Do not push, rerun, cancel, approve, or otherwise mutate GitHub Actions. The
user will review the local changes. If the run is green, do nothing beyond the
read-only fetch.
