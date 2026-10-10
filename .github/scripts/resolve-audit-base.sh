#!/usr/bin/env bash
set -euo pipefail

if [ "$GITHUB_EVENT_NAME" = pull_request ]; then
  git fetch --depth=1 origin "$GITHUB_BASE_REF"
  echo "ref=origin/$GITHUB_BASE_REF" >> "$GITHUB_OUTPUT"
elif [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]; then
  if [ "$GITHUB_REF_TYPE" != branch ]; then
    echo 'Manual diff audits require a branch with exactly one open pull request.' >&2
    exit 1
  fi

  pr_pages=$(gh api --method GET "repos/$GITHUB_REPOSITORY/pulls" \
    -f state=open -f "head=${GITHUB_REPOSITORY%%/*}:$GITHUB_REF_NAME" --paginate --slurp)
  matching_prs=$(jq -ce --arg repository "$GITHUB_REPOSITORY" --arg branch "$GITHUB_REF_NAME" \
    '[.[][] | select(.state == "open" and .head.ref == $branch and .head.repo.full_name == $repository)]' \
    <<< "$pr_pages")
  if [ "$(jq 'length' <<< "$matching_prs")" != 1 ]; then
    echo 'Manual diff audits require exactly one open pull request for the dispatched branch.' >&2
    exit 1
  fi
  if [ "$(jq -r '.[0].head.sha' <<< "$matching_prs")" != "$GITHUB_SHA" ]; then
    echo 'The pull request head changed after dispatch; dispatch again for its current head.' >&2
    exit 1
  fi

  base_ref=$(jq -er '.[0].base.ref | select(type == "string" and length > 0)' <<< "$matching_prs")
  if ! git check-ref-format "refs/heads/$base_ref"; then
    echo 'The pull request did not provide a valid base branch.' >&2
    exit 1
  fi
  git fetch --depth=1 origin "refs/heads/$base_ref"
  base_sha=$(git rev-parse --verify 'FETCH_HEAD^{commit}')
  echo "ref=$base_sha" >> "$GITHUB_OUTPUT"
elif [ -n "${GITHUB_BEFORE:-}" ] &&
     [ "$GITHUB_BEFORE" != 0000000000000000000000000000000000000000 ]; then
  git fetch --depth=1 origin "$GITHUB_BEFORE"
  echo "ref=$GITHUB_BEFORE" >> "$GITHUB_OUTPUT"
else
  git fetch --depth=2 origin "$GITHUB_SHA"
  echo 'ref=HEAD~1' >> "$GITHUB_OUTPUT"
fi
