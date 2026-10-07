#!/usr/bin/env bash
# Prints `changed=false` only when every file a pull request changes is clearly unrelated to the
# live desktop suite, and `changed=true` otherwise, including when the diff cannot be worked out.
#
# Usage: desktop-live-changes.sh <base-sha>
set -u

unrelated='^(apps/docs/|apps/pii/|apps/sim/content/|packages/(python-sdk|ts-sdk)/)|\.mdx?$|(^|/)LICENSE$'

base=${1:-}
run() {
  echo "changed=true"
  echo "Running the live desktop suite: $1" >&2
  exit 0
}
[ -n "$base" ] || run 'no base commit'
git fetch --quiet --depth=1 origin "$base" || run "could not fetch $base"
names=$(git diff --name-only "$base" HEAD) || run "could not diff against $base"
[ -n "$names" ] || run 'no changed files listed'
if printf '%s\n' "$names" | grep -qvE "$unrelated"; then
  run 'a change may affect it'
fi
echo "changed=false"
echo 'Skipping the live desktop suite: every change is unrelated to it' >&2
