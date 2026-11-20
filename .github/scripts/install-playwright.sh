#!/usr/bin/env bash
# The dependency dry run uses the pinned driver's package list without updating apt.
# Browsers restored from the job's ms-playwright cache make `playwright install` a no-op.
set -euo pipefail

browsers=()
for argument in "$@"; do
  case "$argument" in
    --only-shell|--no-shell) ;;
    *) browsers+=("$argument") ;;
  esac
done

started=$SECONDS
if ! bunx --no-install playwright install-deps --dry-run "${browsers[@]}"; then
  bunx --no-install playwright install-deps "${browsers[@]}"
fi
deps_seconds=$((SECONDS - started))
started=$SECONDS
bunx --no-install playwright install "$@"
echo "Playwright system dependencies took ${deps_seconds}s and browsers $((SECONDS - started))s ($*)"
