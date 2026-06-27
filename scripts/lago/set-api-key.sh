#!/usr/bin/env bash
set -euo pipefail

KEY="${1:?Usage: ./scripts/lago/set-api-key.sh <lago-api-key>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ROOT}/apps/sim/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run ./scripts/lago/setup-saas-env.sh first." >&2
  exit 1
fi

if grep -q '^LAGO_API_KEY=' "${ENV_FILE}"; then
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|^LAGO_API_KEY=.*|LAGO_API_KEY=${KEY}|" "${ENV_FILE}"
  else
    sed -i "s|^LAGO_API_KEY=.*|LAGO_API_KEY=${KEY}|" "${ENV_FILE}"
  fi
else
  echo "LAGO_API_KEY=${KEY}" >> "${ENV_FILE}"
fi

echo "✓ LAGO_API_KEY set in apps/sim/.env"
