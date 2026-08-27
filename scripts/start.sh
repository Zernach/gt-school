#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_COMPOSE="${GT_SCHOOL_BACKEND_COMPOSE:-$ROOT_DIR/backend/docker/compose.sh}"
FRONTEND_URL="${GT_SCHOOL_FRONTEND_URL:-http://localhost:5173}"
FRONTEND_LOG_FILE="${GT_SCHOOL_FRONTEND_LOG_FILE:-${TMPDIR:-/tmp}/gt-school-frontend.log}"
FRONTEND_PID=""
BACKEND_SERVICES=(postgres queue init api worker)
MAIN_MENU_ITEMS=("Start stack" "Build" "Verify" "Show status" "Deploy" "Exit")
DEPLOY_MENU_ITEMS=("Frontend" "Backend" "Both" "Cancel")

if [[ -t 1 ]]; then
  ROYAL_PURPLE=$'\033[38;2;120;81;169m'
  ARCTIC_CYAN=$'\033[38;2;0;229;255m'
  RESET=$'\033[0m'
else
  ROYAL_PURPLE=""
  ARCTIC_CYAN=""
  RESET=""
fi

print_plain_menu() {
  local title="$1"
  local prompt="$2"
  shift 2
  local items=("$@")
  local index

  printf '\n%s%s%s\n' "$ROYAL_PURPLE" "$title" "$RESET"
  printf '%s%s%s\n' "$ARCTIC_CYAN" "$prompt" "$RESET"
  for ((index = 0; index < ${#items[@]}; index++)); do
    printf '%s%s)%s %s\n' "$ROYAL_PURPLE" "$((index + 1))" "$RESET" "${items[index]}"
  done
}

print_interactive_menu() {
  local title="$1"
  local selected_index="$2"
  shift 2
  local items=("$@")
  local index

  printf '\033[2J\033[H'
  printf '%s%s%s\n\n' "$ROYAL_PURPLE" "$title" "$RESET"
  for ((index = 0; index < ${#items[@]}; index++)); do
    if (( index == selected_index )); then
      printf '%s> %s%s%s\n' "$ROYAL_PURPLE" "$ARCTIC_CYAN" "${items[index]}" "$RESET"
    else
      printf '  %s\n' "${items[index]}"
    fi
  done
  printf '\n%sUse Up/Down arrows to navigate. Space or Enter selects.%s\n' "$ARCTIC_CYAN" "$RESET"
}

choose_menu_action() {
  local title="$1"
  shift
  local items=("$@")
  local selected_index=0
  local key
  local escape_suffix
  local item_count="${#items[@]}"

  while true; do
    print_interactive_menu "$title" "$selected_index" "${items[@]}"
    if ! IFS= read -rsn1 key; then
      printf '\n'
      return 1
    fi

    if [[ "$key" == $'\e' ]]; then
      escape_suffix=""
      IFS= read -rsn2 -t 0.1 escape_suffix || true
      key+="$escape_suffix"
    fi

    case "$key" in
      $'\e[A'|$'\eOA')
        selected_index=$(( (selected_index - 1 + item_count) % item_count ))
        ;;
      $'\e[B'|$'\eOB')
        selected_index=$(( (selected_index + 1) % item_count ))
        ;;
      ' '|''|$'\r')
        choice=$((selected_index + 1))
        return 0
        ;;
      [1-9])
        if (( 10#$key >= 1 && 10#$key <= item_count )); then
          choice="$key"
          return 0
        fi
        ;;
    esac
  done
}

select_from_menu() {
  local title="$1"
  local prompt="$2"
  shift 2

  if [[ -t 0 && -t 1 ]]; then
    choose_menu_action "$title" "$@" || exit 0
  else
    print_plain_menu "$title" "$prompt" "$@"
    if ! read -r -p "${ARCTIC_CYAN}> ${RESET}" choice; then
      exit 0
    fi
  fi
}

start_backend() {
  if [[ ! -x "$BACKEND_COMPOSE" ]]; then
    echo "Backend Compose wrapper not found: $BACKEND_COMPOSE"
    return 1
  fi

  "$BACKEND_COMPOSE" up --detach --build --wait "${BACKEND_SERVICES[@]}"
  start_local_frontend
}

backend_api_port() {
  local configured_port="${GT_SCHOOL_API_PORT:-${API_PORT:-}}"
  if [[ -z "$configured_port" && -f "$ROOT_DIR/backend/docker/.env" ]]; then
    configured_port="$(awk -F= '$1 == "API_PORT" { print $2; exit }' "$ROOT_DIR/backend/docker/.env")"
  fi
  if [[ "$configured_port" =~ ^[0-9]+$ ]]; then
    printf '%s' "$configured_port"
  else
    printf '3000'
  fi
}

frontend_is_ready() {
  curl --fail --silent --show-error --max-time 2 "$FRONTEND_URL" >/dev/null 2>&1
}

open_local_frontend() {
  if command -v open >/dev/null 2>&1; then
    if ! open "$FRONTEND_URL" >/dev/null 2>&1; then
      printf 'Frontend is ready at %s, but the browser could not be opened automatically.\n' "$FRONTEND_URL"
    fi
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$FRONTEND_URL" >/dev/null 2>&1 &
  else
    printf 'Open %s in a browser.\n' "$FRONTEND_URL"
  fi
}

start_local_frontend() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to start the local frontend server"
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to wait for the local frontend server"
    return 1
  fi

  if ! frontend_is_ready; then
    printf 'Starting local frontend server...\n'
    VITE_API_PROXY_TARGET="${GT_SCHOOL_API_PROXY_TARGET:-http://127.0.0.1:$(backend_api_port)}" \
      npm --prefix "$ROOT_DIR" run dev --workspace @keystone/frontend >"$FRONTEND_LOG_FILE" 2>&1 &
    FRONTEND_PID=$!

    local attempt
    for ((attempt = 1; attempt <= 60; attempt++)); do
      if frontend_is_ready; then
        break
      fi
      if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        printf 'Local frontend failed to start; see %s\n' "$FRONTEND_LOG_FILE"
        return 1
      fi
      sleep 0.5
    done

    if ! frontend_is_ready; then
      kill "$FRONTEND_PID" 2>/dev/null || true
      printf 'Local frontend did not become ready at %s; see %s\n' "$FRONTEND_URL" "$FRONTEND_LOG_FILE"
      return 1
    fi
  fi

  printf 'Local frontend ready at %s\n' "$FRONTEND_URL"
  open_local_frontend
}

build_project() {
  npm --prefix "$ROOT_DIR" run build
  "$BACKEND_COMPOSE" build
}

verify_project() {
  npm --prefix "$ROOT_DIR" run lint
  npm --prefix "$ROOT_DIR" run typecheck
  npm --prefix "$ROOT_DIR" run test
  npm --prefix "$ROOT_DIR" run test:golden
  "$BACKEND_COMPOSE" config --quiet
}

deploy_project() {
  select_from_menu "Deploy" "Select a target:" "${DEPLOY_MENU_ITEMS[@]}"
  case "$choice" in
    1)
      bash "$ROOT_DIR/scripts/deploy_frontend.sh"
      ;;
    2)
      bash "$ROOT_DIR/scripts/deploy_backend.sh"
      ;;
    3)
      bash "$ROOT_DIR/scripts/deploy_cloudflare_demo.sh" both
      ;;
    4)
      return 0
      ;;
    *)
      printf '%sInvalid selection.%s\n' "$ROYAL_PURPLE" "$RESET"
      ;;
  esac
}

run_choice() {
  case "$1" in
    1)
      start_backend
      ;;
    2)
      build_project
      ;;
    3)
      verify_project
      ;;
    4)
      "$BACKEND_COMPOSE" ps
      ;;
    5)
      deploy_project
      ;;
    6)
      exit 0
      ;;
    *)
      printf '%sInvalid selection.%s\n' "$ROYAL_PURPLE" "$RESET"
      ;;
  esac
}

while true; do
  select_from_menu "Project control" "Select an action:" "${MAIN_MENU_ITEMS[@]}"
  run_choice "$choice"
done
