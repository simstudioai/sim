#!/usr/bin/env bash
# Prints which checks a pull request's changes can affect, as `<flag>=true|false` lines for
# $GITHUB_OUTPUT. A flag is `false` only when every changed file is on an allowlist whose jobs
# fully cover it. A file on no allowlist sets every flag but `desktop_live` (which keeps its own
# skip list) to `true`; a change under .github/, an empty diff, or any failure to work out the
# diff sets all of them.
#
#   full          integration, e2e, e2e-build, e2e-mobile: any file not allowlisted below
#   test          the Vitest shards and test-types: content, docs app, and desktop changes,
#                 plus `full`
#   build         the app's `next build`: content changes, plus `full`
#   desktop_live  the live Electron suite: any file outside its own skip list
#
# lint always runs and is not gated.
#
# Usage: ci-changes.sh <base-sha>
set -u

# Posts, author profiles, and the public assets only posts reference. The test shards read them
# (lib/content/og-image.test.ts) and `next build` prerenders every post with its MDX components,
# which check:library-content compiles but never renders. Components under content/ are code.
content='^apps/sim/content/([^/]+/)*[^/]+\.mdx?$|^apps/sim/content/authors/[^/]+\.json$|^apps/sim/public/(authors|blog|changelog|library)/'
# Its own workspace tests, its type-check and docs-manifest audit in lint, and apps/sim tests
# that read its pages (tools/netsuite/netsuite.test.ts).
docs='^apps/docs/'
# Nothing outside the Electron app imports it; the desktop bridge and protocol packages are
# consumed by apps/sim and stay unlisted.
desktop='^apps/desktop/'
# Agent guidance, read only by the lint job's audits.
guidance='^(\.agents|\.claude|\.cursor)/|^([^/]+/)*(AGENTS|CLAUDE)\.md$|^README\.md$'
# The live desktop suite drives apps/desktop against the app, so it skips more than the rest.
desktop_live_skip="$guidance"'|^(apps/docs/|apps/pii/|apps/sim/content/|apps/sim/public/(authors|blog|changelog|library)/|packages/(python-sdk|ts-sdk)/)|\.mdx?$|(^|/)LICENSE$'

emit() {
  printf 'full=%s\ntest=%s\nbuild=%s\ndesktop_live=%s\n' "$1" "$2" "$3" "$4"
}
run_all() {
  emit true true true true
  echo "Running every check: $1" >&2
  exit 0
}
matches() { printf '%s\n' "$names" | grep -qE "$1"; }
outside() { printf '%s\n' "$names" | grep -qvE "$1"; }

base=${1:-}
[ -n "$base" ] || run_all 'no base commit'
git fetch --quiet --depth=1 origin "$base" || run_all "could not fetch $base"
names=$(git diff --no-renames --name-only "$base" HEAD) || run_all "could not diff against $base"
[ -n "$names" ] || run_all 'no changed files listed'
if matches '^\.github/'; then run_all 'a CI file changed'; fi

desktop_live=false
if outside "$desktop_live_skip"; then desktop_live=true; fi
if outside "$content|$docs|$desktop|$guidance"; then
  emit true true true "$desktop_live"
  unlisted=$(printf '%s\n' "$names" | grep -vE "$content|$docs|$desktop|$guidance" | head -n 1)
  echo "Running every check (desktop_live=$desktop_live): $unlisted is not on an allowlist" >&2
  exit 0
fi

test=false build=false
if matches "$content|$docs|$desktop"; then test=true; fi
if matches "$content"; then build=true; fi
emit false "$test" "$build" "$desktop_live"
echo "Scoped checks: test=$test build=$build desktop_live=$desktop_live" >&2
