#!/usr/bin/env bash
# The `ci` job's verdict: the single required check, so it must never pass a run whose checks did
# not all pass. Reads the job's `needs` context (`toJSON(needs)`) from $NEEDS and exits non-zero,
# naming each offending job, unless every job succeeded or was skipped as `changes` intended.
#
# A skip passes only for a gated job whose `changes` flag is exactly `false`:
#
#   Each job maps to its own explicit selection flag below. No inferred skip is accepted.
#
# Every other skip fails: an ungated job (lint, `changes` itself), a gated job whose flag is
# `true`, missing, or anything else (a failed or skipped `changes` leaves no outputs). A failure
# or a cancellation always fails.
#
# Usage: NEEDS='<toJSON(needs)>' ci-gate.sh
set -euo pipefail

needs=${NEEDS:-}
if ! jq -e 'type == "object"' <<< "$needs" > /dev/null 2>&1; then
  echo "::error::The needs context is not a JSON object: '$needs'"
  exit 1
fi

failed="$(jq -r '
  {"integration": "integration", "e2e": "http", "e2e-build": "e2e_build", "e2e-production": "production", "test": "test",
   "test-types": "test_app", "build": "build", "desktop-live": "desktop_live"} as $gate
  | . as $needs
  | (($gate | keys) + ["changes", "lint"]) as $required
  | ($required - keys) as $missing
  | if ($missing | length) > 0 then
      $missing[] | "\(.): missing"
    else
      $needs
  | (.changes.outputs // {}) as $flags
  | to_entries[]
  | select(.value.result != "success")
  | select(.value.result != "skipped" or $gate[.key] == null or $flags[$gate[.key]] != "false")
  | "\(.key): \(.value.result)"
    end
' <<< "$needs")"
if [ -n "$failed" ]; then
  echo "::error::Checks did not pass:"
  echo "$failed"
  exit 1
fi
echo "All checks passed."
