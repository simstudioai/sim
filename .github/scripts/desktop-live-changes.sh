#!/usr/bin/env bash
# Prints `changed=true` when a pull request touches a path the live desktop suite exercises, or when
# the diff cannot be worked out, and `changed=false` otherwise.
#
# The suite (apps/desktop/e2e/desktop-tools-live-sim.spec.ts) drives the Electron app against a
# local Sim, realtime and Redis through the desktop, mothership, copilot, upload and auth routes and
# the chat page. A change that only breaks Sim boot or an unrelated route fails the build and e2e
# jobs, and every staging and main push runs this suite regardless, so a path missing here can
# delay a failure to the staging push but never lets it deploy.
#
# Usage: desktop-live-changes.sh <base-sha>
set -u

relevant='^(apps/desktop/|apps/realtime/'\
'|packages/(desktop-bridge|browser-protocol|terminal-protocol|realtime-protocol|db|auth|emcn|utils|logger|security|platform-authz|runtime-secrets)/'\
'|apps/sim/lib/(desktop|mothership|uploads|auth|terminal|browser-agent|workspaces/permissions|api/(client|server))/'\
'|apps/sim/lib/api/contracts/(chats|copilot|desktop-|mothership-|upload-sessions|workspace-file)'\
'|apps/sim/app/api/(desktop|mothership|copilot|files|v2/uploads|auth|users/me)/'\
'|apps/sim/app/api/workspaces/\[id\]/files/'\
'|apps/sim/app/workspace/\[workspaceId\]/(home/|chat/|components/|layout\.tsx)'\
'|apps/sim/app/(layout\.tsx|desktop/)'\
'|apps/sim/stores/(chat|chat-panel|panel|mothership-[a-z-]+|tool-permission|terminal|copilot-terminal|browser-session)/'\
'|apps/sim/hooks/(use-mothership|use-desktop|use-chat|queries/(mothership|desktop|copilot|chats))'\
'|apps/sim/types/sim-desktop'\
'|apps/sim/(proxy\.ts|next\.config\.ts|package\.json|instrumentation)'\
'|bun\.lock$|package\.json$'\
'|\.github/(workflows/(checks|ci)\.yml|scripts/desktop-live-changes\.sh|actions/))'

base=${1:-}
run() {
  echo "changed=true"
  echo "Running the live desktop suite: $1" >&2
  exit 0
}
[ -n "$base" ] || run 'no base commit'
git fetch --quiet --depth=1 origin "$base" || run "could not fetch $base"
names=$(git diff --no-renames --name-only "$base" HEAD) || run "could not diff against $base"
[ -n "$names" ] || run 'no changed files listed'
printf 'Changed files:\n%s\n' "$names" >&2
match=$(printf '%s\n' "$names" | grep -E -m 1 "$relevant") && run "a change touches a path it exercises: $match"
echo "changed=false"
echo 'Skipping the live desktop suite: no change touches a path it exercises' >&2
