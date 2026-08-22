#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_COMPOSE="$ROOT_DIR/backend/docker/compose.sh"

if [[ -t 1 ]]; then
  ROYAL_PURPLE=$'\033[38;2;120;81;169m'
  ARCTIC_CYAN=$'\033[38;2;0;229;255m'
  RESET=$'\033[0m'
else
  ROYAL_PURPLE=""
  ARCTIC_CYAN=""
  RESET=""
fi

MENU_ITEMS=("Start stack" "Build" "Verify" "Show status" "Exit")

print_plain_menu() {
  printf '\n%sProject control%s\n' "$ROYAL_PURPLE" "$RESET"
  printf '%sSelect an action:%s\n' "$ARCTIC_CYAN" "$RESET"
  local index
  for ((index = 0; index < ${#MENU_ITEMS[@]}; index++)); do
    printf '%s%s)%s %s\n' "$ROYAL_PURPLE" "$((index + 1))" "$RESET" "${MENU_ITEMS[index]}"
  done
}

print_interactive_menu() {
  local selected_index="$1"
  local index

  printf '\033[2J\033[H'
  printf '%sProject control%s\n\n' "$ROYAL_PURPLE" "$RESET"
  for ((index = 0; index < ${#MENU_ITEMS[@]}; index++)); do
    if (( index == selected_index )); then
      printf '%s> %s%s%s\n' "$ROYAL_PURPLE" "$ARCTIC_CYAN" "${MENU_ITEMS[index]}" "$RESET"
    else
      printf '  %s\n' "${MENU_ITEMS[index]}"
    fi
  done
  printf '\n%sUse Up/Down arrows to navigate. Space or Enter selects.%s\n' "$ARCTIC_CYAN" "$RESET"
}

choose_menu_action() {
  local selected_index=0
  local key
  local escape_suffix

  while true; do
    print_interactive_menu "$selected_index"
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
        selected_index=$(( (selected_index - 1 + ${#MENU_ITEMS[@]}) % ${#MENU_ITEMS[@]} ))
        ;;
      $'\e[B'|$'\eOB')
        selected_index=$(( (selected_index + 1) % ${#MENU_ITEMS[@]} ))
        ;;
      ' '|''|$'\r')
        choice=$((selected_index + 1))
        return 0
        ;;
      [1-5])
        choice="$key"
        return 0
        ;;
    esac
  done
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
      exit 0
      ;;
    *)
      printf '%sInvalid selection.%s\n' "$ROYAL_PURPLE" "$RESET"
      ;;
  esac
}

while true; do
  if [[ -t 0 && -t 1 ]]; then
    choose_menu_action || exit 0
  else
    print_plain_menu
    if ! read -r -p "${ARCTIC_CYAN}> ${RESET}" choice; then
      exit 0
    fi
  fi

  run_choice "$choice"
done
