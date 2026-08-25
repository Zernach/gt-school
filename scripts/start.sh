#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_COMPOSE="$ROOT_DIR/backend/docker/compose.sh"
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

  "$BACKEND_COMPOSE" up --detach --build --wait
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
