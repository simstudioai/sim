#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_REPOSITORY_ID:?}"
: "${GITHUB_REF_NAME:?}"
: "${GITHUB_SHA:?}"

provenance=$(cat <<'JQ'
  def trusted:
    .path == ".github/workflows/validation.yml"
    and .event == "push"
    and .head_sha == $sha
    and .head_branch == $branch
    and .repository.full_name == $repo
    and .repository.id == $repo_id
    and .head_repository.full_name == $repo
    and .head_repository.id == $repo_id
    and (.id | type == "number" and . > 0 and floor == .)
    and (.workflow_id | type == "number" and . > 0 and floor == .);
JQ
)

query() {
  jq --arg repo "$GITHUB_REPOSITORY" --arg branch "$GITHUB_REF_NAME" \
    --arg sha "$GITHUB_SHA" --argjson repo_id "$GITHUB_REPOSITORY_ID" "$@"
}

run_id=''
deadline=$((SECONDS + 120))
while [ "$SECONDS" -lt "$deadline" ]; do
  response=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs" --method GET \
    -f event=push -f branch="$GITHUB_REF_NAME" -f head_sha="$GITHUB_SHA" -F per_page=100)
  selection=$(query "$provenance
    if (.workflow_runs | type) != \"array\" or .total_count != (.workflow_runs | length)
    then error(\"Incomplete validation run listing\") else .workflow_runs end
    | map(select(trusted))
    | if length > 1 then error(\"Ambiguous matching push validations\")
      elif length == 1 then .[0] | [.id, .workflow_id] | @tsv
      else empty end" -r <<< "$response")
  if [ -n "$selection" ]; then
    IFS=$'\t' read -r run_id workflow_id <<< "$selection"
    break
  fi
  sleep 2
done

if [ -z "$run_id" ]; then
  echo '::error::No trusted push validation appeared for this exact commit.' >&2
  exit 1
fi

gh run watch "$run_id" --repo "$GITHUB_REPOSITORY" --exit-status --interval 30 --compact
response=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id")
query -e --argjson run_id "$run_id" --argjson workflow_id "$workflow_id" "$provenance
  trusted and .id == \$run_id and .workflow_id == \$workflow_id
  and .status == \"completed\" and .conclusion == \"success\"" <<< "$response" > /dev/null
echo "Push validation $run_id passed for $GITHUB_SHA."
