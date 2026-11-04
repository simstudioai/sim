#!/usr/bin/env bash
# The dependency dry run uses the pinned driver's package list without updating apt.
set -euo pipefail

browsers=()
for argument in "$@"; do
  case "$argument" in
    --only-shell|--no-shell) ;;
    *) browsers+=("$argument") ;;
  esac
done

if ! bunx --no-install playwright install-deps --dry-run "${browsers[@]}"; then
  bunx --no-install playwright install-deps "${browsers[@]}"
fi
exec bunx --no-install playwright install "$@"
