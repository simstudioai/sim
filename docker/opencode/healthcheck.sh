#!/usr/bin/env bash
set -euo pipefail

port="${OPENCODE_PORT:-4096}"
user="${OPENCODE_SERVER_USERNAME:-opencode}"
password="${OPENCODE_SERVER_PASSWORD:-}"

if [[ -z "$password" ]]; then
  exit 1
fi

curl --silent --show-error --fail \
  -u "${user}:${password}" \
  "http://127.0.0.1:${port}/global/health" >/dev/null
