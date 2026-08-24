#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_PROJECT_NAME=gt-school
PAGES_PRODUCTION_BRANCH=main
ZPROFILE_FUNCTION_RUNNER="${ZPROFILE_FUNCTION_RUNNER:-}"

run_wrangler() {
  if [[ -n "$ZPROFILE_FUNCTION_RUNNER" ]]; then
    [[ -x "$ZPROFILE_FUNCTION_RUNNER" ]] || { echo "ZPROFILE_FUNCTION_RUNNER is not executable: $ZPROFILE_FUNCTION_RUNNER" >&2; exit 1; }
    "$ZPROFILE_FUNCTION_RUNNER" run_wrangler_without_vpn npx --no-install wrangler "$@"
  else
    npx --no-install wrangler "$@"
  fi
}

[[ "$(git -C "$ROOT_DIR" branch --show-current)" == main ]] || { echo "Pages bootstrap must run from main." >&2; exit 1; }
[[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || { echo "Pages bootstrap refuses a dirty worktree." >&2; exit 1; }
run_wrangler whoami
run_wrangler pages project create "$PAGES_PROJECT_NAME" --production-branch="$PAGES_PRODUCTION_BRANCH"
echo "Created Direct Upload Pages project $PAGES_PROJECT_NAME on $PAGES_PRODUCTION_BRANCH. Deploy it only with scripts/deploy_cloudflare_demo.sh so its Functions configuration is uploaded with the audited release."
