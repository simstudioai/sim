#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/apps/sim"
exec bun --env-file=.env run scripts/seed-super-admin-user.ts "$@"
