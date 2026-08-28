#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Compose may publish the API on a developer-selected host port. Keep the
# live-integration gate aligned with that shared topology while allowing an
# explicit endpoint for CI or remote targets.
if [[ -z "${INTEGRATION_BASE_URL:-}" ]]; then
  configured_port="${API_PORT:-}"
  if [[ -z "$configured_port" && -f "$ROOT_DIR/backend/docker/.env" ]]; then
    configured_port="$(awk -F= '$1 == "API_PORT" { print $2; exit }' "$ROOT_DIR/backend/docker/.env")"
  fi
  configured_port="${configured_port:-3000}"
  export INTEGRATION_BASE_URL="http://127.0.0.1:${configured_port}"
fi

cd "$ROOT_DIR"
npm run test:integration --workspace @keystone/api -- "$@"
