#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fetch-workflow-failure.sh [options]

Fetch the newest GitHub Actions run for an exact commit. The default commit is
the latest commit on the repository's default branch and the default workflow
is .github/workflows/ci.yml.

Options:
  --workflow PATH       Workflow file, name, or ID (default: .github/workflows/ci.yml)
  --repo OWNER/REPO     GitHub repository (default: resolve from checkout)
  --commit SHA          Commit SHA (default: latest repository commit)
  --limit N             Number of matching runs to inspect (default: 20)
  --output-dir DIR      Persist JSON and failed logs in DIR (default: stdout/temp only)
  -h, --help            Show this help

Exit status:
  0  no matching run, pending/non-error run, or successful run
  2  completed failure-like run; failure logs were fetched
  1  helper or GitHub CLI error
USAGE
}

workflow='.github/workflows/ci.yml'
repo=''
commit=''
limit=20
output_dir=''

while (($# > 0)); do
  case "$1" in
    --workflow)
      [[ $# -ge 2 ]] || { echo 'Missing value for --workflow' >&2; usage >&2; exit 1; }
      workflow=$2
      shift 2
      ;;
    --repo)
      [[ $# -ge 2 ]] || { echo 'Missing value for --repo' >&2; usage >&2; exit 1; }
      repo=$2
      shift 2
      ;;
    --commit)
      [[ $# -ge 2 ]] || { echo 'Missing value for --commit' >&2; usage >&2; exit 1; }
      commit=$2
      shift 2
      ;;
    --limit)
      [[ $# -ge 2 ]] || { echo 'Missing value for --limit' >&2; usage >&2; exit 1; }
      limit=$2
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || { echo 'Missing value for --output-dir' >&2; usage >&2; exit 1; }
      output_dir=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo 'Required command not found: gh' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'Required command not found: jq' >&2; exit 1; }

git_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo 'Run this helper from inside a Git repository.' >&2
  exit 1
}

if [[ ! "$limit" =~ ^[1-9][0-9]*$ ]]; then
  echo "Limit must be a positive integer: $limit" >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || {
    echo 'Could not resolve the GitHub repository from this checkout.' >&2
    exit 1
  }
fi

local_head=$(git -C "$git_root" rev-parse HEAD 2>/dev/null) || {
  echo 'Could not resolve the current checkout HEAD.' >&2
  exit 1
}

if [[ -z "$commit" ]]; then
  commit=$(gh api "repos/$repo/commits?per_page=1" --jq '.[0].sha') || {
    echo 'Could not resolve the latest commit on the GitHub repository default branch.' >&2
    exit 1
  }
fi

if [[ ! "$commit" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "Commit must be a full 40-character SHA: $commit" >&2
  exit 1
fi

if [[ -n "$output_dir" ]]; then
  mkdir -p "$output_dir"
fi

echo "Repository: $repo"
echo "Workflow: $workflow"
echo "Commit: $commit"
echo "Local HEAD: $local_head"
if [[ "$commit" == "$local_head" ]]; then
  echo 'Local source alignment: exact match'
elif git cat-file -e "$commit^{commit}" 2>/dev/null && git merge-base --is-ancestor "$commit" "$local_head"; then
  echo 'Local source alignment: target is an ancestor of local HEAD'
else
  echo 'Local source alignment: target is not an ancestor of local HEAD; diagnostics only'
fi

runs_json=$(gh run list \
  --repo "$repo" \
  --workflow "$workflow" \
  --commit "$commit" \
  --limit "$limit" \
  --json databaseId,conclusion,createdAt,displayTitle,event,headBranch,headSha,name,status,updatedAt,url,workflowName) || {
  echo 'Could not fetch GitHub Actions run metadata.' >&2
  exit 1
}

if [[ -n "$output_dir" ]]; then
  printf '%s\n' "$runs_json" > "$output_dir/runs.json"
fi

run_count=$(jq 'length' <<<"$runs_json")
if [[ "$run_count" == '0' ]]; then
  echo 'No GitHub Actions run exists for this exact commit and workflow.'
  exit 0
fi

run_json=$(jq -c 'sort_by(.createdAt) | last' <<<"$runs_json")
run_id=$(jq -r '.databaseId' <<<"$run_json")
run_status=$(jq -r '.status // "unknown"' <<<"$run_json")
run_conclusion=$(jq -r '.conclusion // "pending"' <<<"$run_json")
run_url=$(jq -r '.url // "unavailable"' <<<"$run_json")

echo "Run: $run_id"
echo "Status: $run_status"
echo "Conclusion: $run_conclusion"
echo "URL: $run_url"

detail_json=$(gh run view "$run_id" --repo "$repo" --json databaseId,conclusion,createdAt,displayTitle,event,headBranch,headSha,jobs,name,startedAt,status,updatedAt,url,workflowName) || {
  echo "Could not fetch details for GitHub Actions run $run_id." >&2
  exit 1
}

if [[ -n "$output_dir" ]]; then
  printf '%s\n' "$run_json" > "$output_dir/run.json"
  printf '%s\n' "$detail_json" > "$output_dir/details.json"
fi

echo 'Jobs:'
if [[ "$(jq '.jobs | length' <<<"$detail_json")" == '0' ]]; then
  echo '  (no job details returned)'
else
  jq -r '.jobs[] | "  \(.name)\tstatus=\(.status // "unknown")\tconclusion=\(.conclusion // "pending")"' <<<"$detail_json"
fi

case "$run_status:$run_conclusion" in
  completed:failure|completed:startup_failure|completed:timed_out)
    temp_log=$(mktemp -t github-actions-failed-log.XXXXXX)
    trap 'rm -f "$temp_log"' EXIT
    if ! gh run view "$run_id" --repo "$repo" --log-failed >"$temp_log" 2>&1; then
      echo "Failed-step log retrieval returned an error for run $run_id." >&2
      if [[ ! -s "$temp_log" ]]; then
        echo 'No failed-step log content was returned.' >&2
      fi
    fi
    if [[ -n "$output_dir" ]]; then
      cp "$temp_log" "$output_dir/failed.log"
      echo "Failed log: $output_dir/failed.log"
    else
      echo 'Failed-step logs:'
      sed 's/^/  /' "$temp_log"
    fi
    exit 2
    ;;
  completed:success|completed:neutral|completed:skipped)
    echo 'No actionable CI error was found.'
    exit 0
    ;;
  completed:cancelled)
    echo 'The run was canceled; this is not an actionable code failure.'
    exit 0
    ;;
  *)
    echo 'The run has not reached an actionable completed conclusion.'
    exit 0
    ;;
esac
