#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_sha="$(git -C "$ROOT_DIR" rev-parse HEAD)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/keystone-cloudflare-deploy-test.XXXXXX")"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT
mkdir -p "$tmp_dir/bin"

cat >"$tmp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *'status --porcelain'* ]]; then [[ "${GT_SCHOOL_TEST_GIT_DIRTY:-0}" == 1 ]] && printf ' M changed\n'; exit 0; fi
if [[ "$args" == *'branch --show-current'* ]]; then printf '%s\n' "${GT_SCHOOL_TEST_BRANCH:-main}"; exit 0; fi
if [[ "$args" == *'rev-parse HEAD'* ]]; then printf '%s\n' "$GT_SCHOOL_TEST_SHA"; exit 0; fi
if [[ "$args" == *'rev-parse origin/main'* ]]; then printf '%s\n' "${GT_SCHOOL_TEST_ORIGIN_SHA:-$GT_SCHOOL_TEST_SHA}"; exit 0; fi
if [[ "$args" == *'fetch origin main'* ]]; then printf 'git fetch\n' >>"$GT_SCHOOL_TEST_LOG"; exit 0; fi
echo "unexpected git command: $args" >&2
exit 1
EOF

cat >"$tmp_dir/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
if [[ "$*" == 'run benchmark' && "${GT_SCHOOL_TEST_BENCHMARK_FAILURE:-0}" == 1 ]]; then
  exit 1
fi
EOF

cat >"$tmp_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
if [[ "$*" == *'--write-out'* ]]; then
  count=0
  [[ -f "$GT_SCHOOL_TEST_READY_COUNTER" ]] && count="$(<"$GT_SCHOOL_TEST_READY_COUNTER")"
  count=$((count + 1))
  printf '%s' "$count" >"$GT_SCHOOL_TEST_READY_COUNTER"
  printf '%s' "${GT_SCHOOL_TEST_READY_STATUS:-200}"
fi
EOF

cat >"$tmp_dir/bin/sleep" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
EOF

cat >"$tmp_dir/zprofile-runner" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'wrangler %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
if [[ "$*" == *' containers list --json'* ]]; then
  count=0
  [[ -f "$GT_SCHOOL_TEST_CONTAINER_COUNTER" ]] && count="$(<"$GT_SCHOOL_TEST_CONTAINER_COUNTER")"
  count=$((count + 1))
  printf '%s' "$count" >"$GT_SCHOOL_TEST_CONTAINER_COUNTER"
  version=2
  (( count == 1 )) && version=1
  printf '[{"id":"00000000-0000-4000-8000-000000000001","name":"gt-school-demo-api-keystonedemocontainer","version":%s}]\n' "$version"
  exit 0
fi
if [[ "$*" == *' containers instances 00000000-0000-4000-8000-000000000001 --json'* ]]; then
  printf '[{"id":"instance-demo-id","state":"running","version":2}]\n'
  exit 0
fi
if [[ "$*" == *' wrangler deploy '* ]]; then
  printf 'Published https://gt-school-demo-api.example.workers.dev\nWorker Version ID: worker-demo-version\n'
fi
EOF
chmod +x "$tmp_dir/bin/git" "$tmp_dir/bin/npm" "$tmp_dir/bin/curl" "$tmp_dir/bin/sleep" "$tmp_dir/zprofile-runner"

log_file="$tmp_dir/commands.log"
grep -q 'ZPROFILE_FUNCTION_RUNNER="${ZPROFILE_FUNCTION_RUNNER:-$HOME/code/zprofile/zprofile-run-function.zsh}"' "$ROOT_DIR/scripts/bootstrap_cloudflare_pages.sh"
grep -q 'ZPROFILE_FUNCTION_RUNNER="${ZPROFILE_FUNCTION_RUNNER:-$HOME/code/zprofile/zprofile-run-function.zsh}"' "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh"
run_release() {
    : >"$tmp_dir/ready-counter"
    : >"$tmp_dir/container-counter"
    GT_SCHOOL_TEST_LOG="${GT_SCHOOL_TEST_LOG:-$log_file}" \
    GT_SCHOOL_TEST_SHA="$source_sha" \
    GT_SCHOOL_TEST_READY_COUNTER="$tmp_dir/ready-counter" \
    GT_SCHOOL_TEST_CONTAINER_COUNTER="$tmp_dir/container-counter" \
    GT_SCHOOL_TEST_BENCHMARK_FAILURE="${GT_SCHOOL_TEST_BENCHMARK_FAILURE:-0}" \
    GT_SCHOOL_READY_ATTEMPTS=3 \
    GT_SCHOOL_READY_INTERVAL_SECONDS=1 \
    GT_SCHOOL_CONTAINER_ROLLOUT_ATTEMPTS=3 \
    GT_SCHOOL_CONTAINER_ROLLOUT_INTERVAL_SECONDS=1 \
    GT_SCHOOL_CONTAINER_ROLLOUT_STABLE_POLLS=2 \
    ZPROFILE_FUNCTION_RUNNER="$tmp_dir/zprofile-runner" \
    PATH="$tmp_dir/bin:$PATH" \
    bash "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh" "$@"
}

run_release >/dev/null
grep -q "git fetch" "$log_file"
grep -q "npm ci --include=dev --include-workspace-root --ignore-scripts" "$log_file"
grep -q 'REQUIRED_RELEASE_EXECUTABLES=(eslint tsx tsc vite vitest wrangler playwright)' "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh"
grep -q 'unset npm_config_argv' "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh"
grep -q "npm run seed -- --seed 424242" "$log_file"
grep -q "npm run test:cloudflare-image" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler whoami" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler containers images list --json" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler containers list --json" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler containers instances 00000000-0000-4000-8000-000000000001 --json" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler deploy --tag=$source_sha --message=gt-school demo $source_sha" "$log_file"
grep -q "npm run verify:cloudflare-demo --workspace @keystone/api --" "$log_file"
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler pages deploy dist --project-name=gt-school --branch=main --commit-hash=$source_sha --commit-dirty=false" "$log_file"
grep -q "npm run test:e2e" "$log_file"

registry_line="$(grep -n 'containers images list' "$log_file" | cut -d: -f1 | tail -1)"
worker_line="$(grep -n 'wrangler deploy --tag' "$log_file" | cut -d: -f1 | tail -1)"
container_line="$(grep -n 'containers instances 00000000-0000-4000-8000-000000000001' "$log_file" | cut -d: -f1 | head -1)"
suite_line="$(grep -n 'npm run verify:cloudflare-demo' "$log_file" | cut -d: -f1 | tail -1)"
pages_line="$(grep -n 'pages deploy' "$log_file" | cut -d: -f1 | tail -1)"
live_browser_line="$(grep -n 'npm run test:e2e' "$log_file" | cut -d: -f1 | tail -1)"
[[ "$registry_line" -lt "$worker_line" && "$worker_line" -lt "$container_line" && "$container_line" -lt "$suite_line" && "$suite_line" -lt "$pages_line" && "$pages_line" -lt "$live_browser_line" ]] || { echo "release ordering was not fail-closed" >&2; exit 1; }
health_line="$(grep -n 'curl .*workers.dev/health' "$log_file" | cut -d: -f1 | head -1)"
[[ "$worker_line" -lt "$health_line" && "$health_line" -lt "$container_line" ]] || { echo "release must wake the request-started Container before checking its revision" >&2; exit 1; }
[[ "$(grep -c 'curl .*workers.dev/ready' "$log_file")" == 3 ]] || { echo "release must require three consecutive readiness probes" >&2; exit 1; }

if GT_SCHOOL_TEST_GIT_DIRTY=1 run_release >"$tmp_dir/dirty.log" 2>&1; then
  echo "dirty release must fail" >&2
  exit 1
fi
grep -q 'release refuses a dirty worktree' "$tmp_dir/dirty.log"
if grep -q 'containers images list' "$tmp_dir/dirty.log"; then
  echo "dirty release reached Cloudflare preflight" >&2
  exit 1
fi

if GT_SCHOOL_TEST_ORIGIN_SHA=0000000000000000000000000000000000000000 run_release >"$tmp_dir/stale.log" 2>&1; then
  echo "stale release must fail" >&2
  exit 1
fi
grep -q 'HEAD must exactly match origin/main' "$tmp_dir/stale.log"

benchmark_log="$tmp_dir/benchmark-commands.log"
if GT_SCHOOL_TEST_BENCHMARK_FAILURE=1 GT_SCHOOL_TEST_LOG="$benchmark_log" run_release backend >"$tmp_dir/benchmark-failure.log" 2>&1; then
  echo "benchmark failure must stop a backend release" >&2
  exit 1
fi
grep -q 'npm run benchmark' "$benchmark_log"
if grep -q 'wrangler run_wrangler_without_vpn npx --no-install wrangler whoami' "$benchmark_log"; then
  echo "benchmark failure reached Cloudflare authentication" >&2
  exit 1
fi

if bash "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh" nope >"$tmp_dir/bad-target.log" 2>&1; then
  echo "invalid target must fail" >&2
  exit 1
fi
grep -q 'deploy target must be frontend, backend, or both' "$tmp_dir/bad-target.log"

frontend_log="$tmp_dir/frontend.log"
GT_SCHOOL_TEST_LOG="$frontend_log" run_release frontend >/dev/null
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler pages deploy dist --project-name=gt-school --branch=main --commit-hash=$source_sha --commit-dirty=false" "$frontend_log"
grep -q "npm run test:e2e" "$frontend_log"
if grep -q 'containers images list' "$frontend_log"; then
  echo "frontend release must not preflight the Container registry" >&2
  exit 1
fi
if grep -q 'wrangler deploy --tag' "$frontend_log"; then
  echo "frontend release must not deploy the Worker" >&2
  exit 1
fi
if grep -q 'verify:cloudflare-demo' "$frontend_log"; then
  echo "frontend release must not run Worker live verification" >&2
  exit 1
fi
[[ "$(grep -c 'npm run test:e2e' "$frontend_log")" == 2 ]] || { echo "frontend release must keep local e2e then live Pages e2e" >&2; exit 1; }

backend_log="$tmp_dir/backend.log"
GT_SCHOOL_TEST_LOG="$backend_log" run_release backend >/dev/null
grep -q "wrangler run_wrangler_without_vpn npx --no-install wrangler deploy --tag=$source_sha --message=gt-school demo $source_sha" "$backend_log"
grep -q "npm run verify:cloudflare-demo --workspace @keystone/api --" "$backend_log"
grep -q "npm run compose:up:backend" "$backend_log"
if grep -q 'pages deploy' "$backend_log"; then
  echo "backend release must not upload Pages" >&2
  exit 1
fi
if grep -q 'npm run test:e2e' "$backend_log"; then
  echo "backend release must not require the frontend browser test" >&2
  exit 1
fi

wrapper_log="$tmp_dir/frontend-wrapper.log"
GT_SCHOOL_TEST_LOG="$wrapper_log" \
GT_SCHOOL_TEST_SHA="$source_sha" \
GT_SCHOOL_TEST_READY_COUNTER="$tmp_dir/ready-counter" \
GT_SCHOOL_TEST_CONTAINER_COUNTER="$tmp_dir/container-counter" \
GT_SCHOOL_READY_ATTEMPTS=3 \
GT_SCHOOL_READY_INTERVAL_SECONDS=1 \
GT_SCHOOL_CONTAINER_ROLLOUT_ATTEMPTS=3 \
GT_SCHOOL_CONTAINER_ROLLOUT_INTERVAL_SECONDS=1 \
GT_SCHOOL_CONTAINER_ROLLOUT_STABLE_POLLS=2 \
ZPROFILE_FUNCTION_RUNNER="$tmp_dir/zprofile-runner" \
PATH="$tmp_dir/bin:$PATH" \
bash "$ROOT_DIR/scripts/deploy_frontend.sh" >/dev/null
grep -q 'pages deploy' "$wrapper_log"
if grep -q 'wrangler deploy --tag' "$wrapper_log"; then
  echo "deploy_frontend.sh must not deploy the Worker" >&2
  exit 1
fi

grep -q 'Deploy' "$ROOT_DIR/scripts/start.sh"
grep -q 'deploy_frontend.sh' "$ROOT_DIR/scripts/start.sh"
grep -q 'deploy_backend.sh' "$ROOT_DIR/scripts/start.sh"
menu_output="$(printf '5\n4\n6\n' | bash "$ROOT_DIR/scripts/start.sh")"
printf '%s\n' "$menu_output" | grep -q 'Deploy'
printf '%s\n' "$menu_output" | grep -q 'Frontend'
printf '%s\n' "$menu_output" | grep -q 'Backend'
printf '%s\n' "$menu_output" | grep -q 'Both'
printf '%s\n' "$menu_output" | grep -q 'Cancel'
echo "Cloudflare deployment automation tests passed"
