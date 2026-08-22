#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="$ROOT_DIR/backend/docker/compose.sh"

restore_worker() {
  "$COMPOSE" start worker >/dev/null 2>&1 || true
}
trap restore_worker EXIT

"$COMPOSE" stop --timeout 15 worker
RECOVERY_OUTPUT="$("$COMPOSE" run --no-deps --rm -T init node dist/cli/worker-recovery.js prepare)"
RECOVERY_FIELDS="$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write([value.jobId, value.firstStreamId, value.secondStreamId].join(" "));' "$RECOVERY_OUTPUT")"
read -r JOB_ID FIRST_STREAM_ID SECOND_STREAM_ID <<< "$RECOVERY_FIELDS"

"$COMPOSE" start worker
"$COMPOSE" run --no-deps --rm -T init node dist/cli/worker-recovery.js verify "$JOB_ID" "$FIRST_STREAM_ID" "$SECOND_STREAM_ID"

trap - EXIT
