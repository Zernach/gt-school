#!/usr/bin/env bash
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DOCKER_DIR/../.." && pwd)"
ENV_FILE="$DOCKER_DIR/.env"
ENV_EXAMPLE="$DOCKER_DIR/.env.example"
LOCAL_COMPOSE_FILE="$DOCKER_DIR/compose.local.yaml"
PROJECT_NAME="$(basename "$ROOT_DIR" | LC_ALL=C tr '[:upper:]' '[:lower:]' | LC_ALL=C tr -cs 'a-z0-9_-' '-')"

case "$PROJECT_NAME" in
  [a-z0-9]*) ;;
  *) PROJECT_NAME="project-$PROJECT_NAME" ;;
esac

COMPOSE_ARGS=(
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  --file "$DOCKER_DIR/compose.yaml"
)

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created local backend environment file: $ENV_FILE"
fi

if [[ -f "$LOCAL_COMPOSE_FILE" ]]; then
  COMPOSE_ARGS+=(--file "$LOCAL_COMPOSE_FILE")
fi

exec docker compose "${COMPOSE_ARGS[@]}" "$@"
