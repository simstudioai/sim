#!/usr/bin/env bash
# Select tasks from the committed Turborepo graph; unknown files or failed attribution run all.
# Usage: ci-changes.sh [base-sha]. No base runs the complete push/dispatch gate.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec bun "$script_dir/../../scripts/ci-plan.ts" "${1:-}"
