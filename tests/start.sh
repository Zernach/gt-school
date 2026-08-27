#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/keystone-start-test.XXXXXX")"
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT
mkdir -p "$tmp_dir/bin"

log_file="$tmp_dir/commands.log"
ready_counter="$tmp_dir/ready-counter"

cat >"$tmp_dir/backend-compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'compose %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
EOF

cat >"$tmp_dir/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s api-proxy %s\n' "$*" "${VITE_API_PROXY_TARGET:-unset}" >>"$GT_SCHOOL_TEST_LOG"
EOF

cat >"$tmp_dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
count=0
[[ -f "$GT_SCHOOL_TEST_READY_COUNTER" ]] && count="$(<"$GT_SCHOOL_TEST_READY_COUNTER")"
count=$((count + 1))
printf '%s' "$count" >"$GT_SCHOOL_TEST_READY_COUNTER"
if (( count >= 2 )); then
  exit 0
fi
exit 1
EOF

cat >"$tmp_dir/bin/open" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'open %s\n' "$*" >>"$GT_SCHOOL_TEST_LOG"
EOF

chmod +x "$tmp_dir/backend-compose" "$tmp_dir/bin/npm" "$tmp_dir/bin/curl" "$tmp_dir/bin/open"

GT_SCHOOL_BACKEND_COMPOSE="$tmp_dir/backend-compose" \
GT_SCHOOL_API_PORT=3000 \
GT_SCHOOL_FRONTEND_URL=http://localhost:5173 \
GT_SCHOOL_FRONTEND_LOG_FILE="$tmp_dir/frontend.log" \
GT_SCHOOL_TEST_LOG="$log_file" \
GT_SCHOOL_TEST_READY_COUNTER="$ready_counter" \
PATH="$tmp_dir/bin:$PATH" \
bash "$ROOT_DIR/scripts/start.sh" <<< $'1\n6\n' >/dev/null

grep -q 'compose up --detach --build --wait postgres queue init api worker' "$log_file"
if grep -q '^compose .*frontend' "$log_file"; then
  echo 'Start stack must not invoke the frontend Compose service' >&2
  exit 1
fi
grep -q 'npm --prefix ' "$log_file"
grep -q 'run dev --workspace @keystone/frontend' "$log_file"
grep -q 'api-proxy http://127.0.0.1:3000' "$log_file"
grep -q 'open http://localhost:5173' "$log_file"
echo 'Start stack backend/frontend handoff test passed'
