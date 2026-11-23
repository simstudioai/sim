#!/usr/bin/env bash
# Blocks until this run's `build (e2e)` job finishes, so an e2e job can check out, install and
# migrate while the build runs instead of after it. Exits 0 only when that job succeeded; a failed,
# cancelled or skipped build, a missing or duplicated build job, or a failed API call exits non-zero.
# The job's own timeout bounds the wait.
#
# Usage: wait-for-e2e-build.sh (reads GITHUB_REPOSITORY and GITHUB_RUN_ID; needs `actions: read`)
set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ID:?}"

poll_seconds=${E2E_BUILD_POLL_SECONDS:-10}
started=$SECONDS

while :; do
  # `filter=latest` lists each job's latest attempt, so re-running only a failed e2e job still sees
  # the build an earlier attempt finished. Called from ci.yml the name carries a `checks / ` prefix.
  state=$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs?filter=latest&per_page=100" \
    --jq '.jobs[] | select(.name == "build (e2e)" or (.name | endswith(" / build (e2e)")))
      | "\(.status) \(.conclusion // "")"')
  matches=$(printf '%s' "$state" | grep -c . || true)
  if [ "$matches" -ne 1 ]; then
    echo "::error::Expected one build (e2e) job in this run, found $matches."
    exit 1
  fi
  read -r status conclusion <<< "$state"
  if [ "$status" = completed ]; then
    if [ "$conclusion" = success ]; then
      echo "build (e2e) finished; waited $((SECONDS - started))s"
      exit 0
    fi
    echo "::error::build (e2e) finished with '$conclusion'; there is no build to test."
    exit 1
  fi
  sleep "$poll_seconds"
done
