#!/usr/bin/env bash
set -euo pipefail

# Promotes configured PLATFORM_ADMIN_EMAILS to Sim platform admin (role=admin).
# Usage: bun run scripts/seed-platform-admin.ts

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/apps/sim"
exec bun run scripts/seed-platform-admin.ts "$@"
