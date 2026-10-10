#!/usr/bin/env bash
# Prints `proven=true` when the checked-out main commit is a merge whose tree is byte-identical to
# its staging parent and a staging push run of that parent passed `checks / ci`; `proven=false`
# otherwise, including on any error, so the caller falls back to running the full checks.
#
# A release lands on main as a merge of the staging head, and the merge's tree equals that head's
# tree, so the staging push run already checked exactly this code with the same checks.yml.
# Waits for a staging run that is still in progress, up to PROOF_WAIT_SECONDS.
#
# Usage: GH_TOKEN=... GITHUB_REPOSITORY=owner/repo staging-proof.sh   (needs fetch-depth: 2)
set -u

prove() {
  echo "proven=$1"
  echo "$2" >&2
  exit 0
}

staging=$(git rev-parse -q --verify 'HEAD^2') || prove false 'Not a merge commit; running the checks.'
[ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$staging^{tree}")" ] ||
  prove false "The tree differs from staging parent $staging; running the checks."

deadline=$((SECONDS + ${PROOF_WAIT_SECONDS:-2400}))
while :; do
  runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=$staging&event=push&branch=staging&per_page=20" \
    --jq '.workflow_runs[] | "\(.id) \(.status)"') || prove false 'Could not list staging runs; running the checks.'
  [ -n "$runs" ] || prove false "No staging push run for $staging; running the checks."
  pending=false
  while read -r id status; do
    gate=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/jobs?per_page=100" \
      --jq '[.jobs[] | select(.name == "checks / ci") | .conclusion] | first // ""') || gate=''
    [ "$gate" = success ] && prove true "Staging run $id passed checks / ci on this exact tree ($staging); skipping the checks."
    [ "$status" = completed ] || pending=true
  done <<< "$runs"
  [ "$pending" = true ] || prove false "No staging run for $staging passed checks / ci; running the checks."
  [ "$SECONDS" -lt "$deadline" ] || prove false "Timed out waiting for the staging run of $staging; running the checks."
  sleep 30
done
