#!/usr/bin/env bash
# Vercel's Ignored Build Step for the docs project (`ignoreCommand` in vercel.json), run from
# apps/docs before install. Exit 0 skips the build; exit 1 builds.
#
# Vercel's "skip unaffected projects" already drops commits that touch neither docs nor a
# workspace package it depends on. Of the rest, production and the staging integration branch
# always build, so a shared-package change that breaks the docs build still fails on staging
# before it reaches main. Any other preview branch builds only when it changes docs itself.
#
# Anything this script cannot decide builds: a branch's first deployment (no previous SHA) and a
# previous deployment outside the shallow clone.
set -uo pipefail

if [[ "${VERCEL_ENV:-}" == production || "${VERCEL_GIT_COMMIT_REF:-}" == staging ]]; then
  exit 1
fi

previous=${VERCEL_GIT_PREVIOUS_SHA:-}
if [[ -z "$previous" ]] || ! git cat-file -e "${previous}^{commit}" 2> /dev/null; then
  echo "No previous deployment in this clone; building."
  exit 1
fi

if git diff --quiet "$previous" HEAD -- .; then
  echo "No docs changes since ${previous}; skipping this preview."
  exit 0
fi
exit 1
