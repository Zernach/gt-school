#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend/cloudflare"
FRONTEND_DIR="$ROOT_DIR/frontend"
PAGES_PROJECT_NAME=gt-school
WORKER_NAME=gt-school-demo-api
ZPROFILE_FUNCTION_RUNNER="${ZPROFILE_FUNCTION_RUNNER:-}"
BACKEND_WORKER_URL="${GT_SCHOOL_BACKEND_WORKER_URL:-}"
READY_ATTEMPTS="${GT_SCHOOL_READY_ATTEMPTS:-90}"
READY_INTERVAL_SECONDS="${GT_SCHOOL_READY_INTERVAL_SECONDS:-5}"
RELEASE_STARTED_AT="$(date +%s)"
SOURCE_SHA=unresolved
DEPLOYED_WORKER_VERSION_ID=not-deployed
DEPLOYED_PAGES_DEPLOYMENT=not-deployed
rollback_reported=false
registry_preflight=""
worker_deploy_output=""
pages_deploy_output=""
ready_headers=""

run_wrangler() {
  if [[ -n "$ZPROFILE_FUNCTION_RUNNER" ]]; then
    [[ -x "$ZPROFILE_FUNCTION_RUNNER" ]] || { echo "ZPROFILE_FUNCTION_RUNNER is not executable: $ZPROFILE_FUNCTION_RUNNER" >&2; exit 1; }
    "$ZPROFILE_FUNCTION_RUNNER" run_wrangler_without_vpn npx --no-install wrangler "$@"
  else
    npx --no-install wrangler "$@"
  fi
}

print_manual_rollback() {
  local reason="$1"
  cat >&2 <<EOF
Cloudflare demo release stopped: $reason
Worker: $WORKER_NAME; uploaded version: $DEPLOYED_WORKER_VERSION_ID; Pages project: $PAGES_PROJECT_NAME; uploaded deployment: $DEPLOYED_PAGES_DEPLOYMENT; source SHA: $SOURCE_SHA.
If the Worker upload completed, immediately restore its preceding active version with:
  (cd "$BACKEND_DIR" && npx --no-install wrangler rollback --name "$WORKER_NAME" --message "manual rollback after failed gt-school demo release")
If the Pages upload completed, use Workers & Pages > $PAGES_PROJECT_NAME > Deployments > the prior production deployment > Rollback to this deployment. Pages Direct Upload has no Wrangler rollback command.
EOF
}

fail() {
  rollback_reported=true
  print_manual_rollback "$1"
  exit 1
}

finish() {
  local status=$?
  rm -f "${registry_preflight:-}" "${worker_deploy_output:-}" "${pages_deploy_output:-}" "${ready_headers:-}"
  if (( status != 0 )) && [[ "$rollback_reported" != true ]]; then
    print_manual_rollback "release command failed with exit status $status"
  fi
  return "$status"
}
trap finish EXIT

for setting in READY_ATTEMPTS READY_INTERVAL_SECONDS; do
  [[ "${!setting}" =~ ^[1-9][0-9]*$ ]] || fail "$setting must be a positive integer"
done
(( READY_ATTEMPTS <= 120 )) || fail "GT_SCHOOL_READY_ATTEMPTS must not exceed 120"
(( READY_INTERVAL_SECONDS <= 30 )) || fail "GT_SCHOOL_READY_INTERVAL_SECONDS must not exceed 30"

[[ "$(git -C "$ROOT_DIR" branch --show-current)" == main ]] || fail "release must run from the main branch"
[[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || fail "release refuses a dirty worktree"
SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "HEAD is not a full SHA"
git -C "$ROOT_DIR" fetch origin main
[[ "$(git -C "$ROOT_DIR" rev-parse origin/main)" == "$SOURCE_SHA" ]] || fail "HEAD must exactly match origin/main"

echo "Preparing Cloudflare demo release sha=$SOURCE_SHA"
npm ci --ignore-scripts
npm run seed -- --seed 424242
npm run lint
npm run typecheck
npm run test:coverage
npm run test:ratio
npm run test:golden
npm run build
npm run compose:config
npm run test:cloudflare
npm run test:deploy
npm run dry-run --workspace @keystone/cloudflare-ingress
npm run test:cloudflare-image
npm run compose:up
npm run test:security
npm run test:worker-recovery
npm run test:integration
npm run suite
npm run test:spend-cap
npm run benchmark
npm run test:e2e

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Preflighting Wrangler authentication"
  run_wrangler whoami
fi
registry_preflight="$(mktemp "${TMPDIR:-/tmp}/gt-school-container-registry.XXXXXX")"
worker_deploy_output="$(mktemp "${TMPDIR:-/tmp}/gt-school-worker-deploy.XXXXXX")"
pages_deploy_output="$(mktemp "${TMPDIR:-/tmp}/gt-school-pages-deploy.XXXXXX")"
ready_headers="$(mktemp "${TMPDIR:-/tmp}/gt-school-ready-headers.XXXXXX")"
if ! run_wrangler containers images list --json >"$registry_preflight" 2>&1; then
  cat "$registry_preflight" >&2
  fail "managed Container registry entitlement is unavailable; confirm Workers Paid and Containers access before retrying"
fi

if ! (cd "$BACKEND_DIR" && run_wrangler deploy --tag="$SOURCE_SHA" --message="gt-school demo $SOURCE_SHA") | tee "$worker_deploy_output"; then
  fail "Worker deployment failed"
fi
DEPLOYED_WORKER_VERSION_ID="$(sed -nE 's/^(Current |Worker )?Version ID:[[:space:]]*([^[:space:]]+).*$/\2/p' "$worker_deploy_output" | tail -1)"
[[ -n "$DEPLOYED_WORKER_VERSION_ID" ]] || DEPLOYED_WORKER_VERSION_ID=unresolved
if [[ -z "$BACKEND_WORKER_URL" ]]; then
  BACKEND_WORKER_URL="$(grep -Eo "https://${WORKER_NAME}\.[A-Za-z0-9.-]+\.workers\.dev" "$worker_deploy_output" | tail -1 || true)"
fi
[[ -n "$BACKEND_WORKER_URL" ]] || fail "Worker deployed but its workers.dev URL was not discoverable; set GT_SCHOOL_BACKEND_WORKER_URL to run bounded live validation"

ready_url="${BACKEND_WORKER_URL%/}/ready"
consecutive_ready=0
last_status=000
for ((attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1)); do
  : >"$ready_headers"
  last_status="$(curl --silent --output /dev/null --dump-header "$ready_headers" --write-out '%{http_code}' --max-time 30 "$ready_url" || true)"
  [[ "$last_status" =~ ^[0-9]{3}$ ]] || last_status=000
  if [[ "$last_status" =~ ^2[0-9]{2}$ ]]; then
    consecutive_ready=$((consecutive_ready + 1))
    if (( consecutive_ready == 3 )); then break; fi
  else
    consecutive_ready=0
  fi
  (( attempt < READY_ATTEMPTS )) && sleep "$READY_INTERVAL_SECONDS"
done
(( consecutive_ready == 3 )) || fail "Worker did not return three consecutive ready responses at $ready_url (last HTTP $last_status)"

API_BASE_URL="$BACKEND_WORKER_URL" npm run suite --workspace @keystone/api --
if ! (cd "$FRONTEND_DIR" && run_wrangler pages deploy dist --project-name="$PAGES_PROJECT_NAME" --branch=main --commit-hash="$SOURCE_SHA" --commit-dirty=false) | tee "$pages_deploy_output"; then
  fail "Pages deployment failed"
fi
DEPLOYED_PAGES_DEPLOYMENT="$(grep -Eo 'https://[^[:space:]]+' "$pages_deploy_output" | tail -1 || true)"
[[ -n "$DEPLOYED_PAGES_DEPLOYMENT" ]] || DEPLOYED_PAGES_DEPLOYMENT=unresolved
curl --fail --silent --show-error --max-time 30 "https://${PAGES_PROJECT_NAME}.pages.dev/" >/dev/null || fail "Pages upload completed but the static dashboard did not respond"
CLOUDFLARE_DEMO_LIVE=1 FRONTEND_BASE_URL="https://${PAGES_PROJECT_NAME}.pages.dev" npm run test:e2e

elapsed=$(( $(date +%s) - RELEASE_STARTED_AT ))
echo "Cloudflare demo release verified: backend=$BACKEND_WORKER_URL pages=https://${PAGES_PROJECT_NAME}.pages.dev sha=$SOURCE_SHA elapsed_seconds=$elapsed"
