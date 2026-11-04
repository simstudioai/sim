#!/usr/bin/env bash
# Owns one pinned WebKit server; start prints its loopback endpoint, stop preserves its logs.
set -euo pipefail
umask 077

action=${1:-}
state_argument=${2:-}
if [ "$#" -ne 2 ] || { [ "$action" != start ] && [ "$action" != stop ]; }; then
  echo 'Usage: playwright-server.sh <start|stop> <state-directory-under-RUNNER_TEMP>' >&2
  exit 2
fi
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID must be set}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT must be set}"
: "${GITHUB_JOB:?GITHUB_JOB must be set}"
if ! [[ "$GITHUB_RUN_ID" =~ ^[1-9][0-9]*$ && "$GITHUB_RUN_ATTEMPT" =~ ^[1-9][0-9]*$ && "$GITHUB_JOB" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo 'Invalid GitHub job ownership metadata.' >&2
  exit 2
fi
state=$(node - "$RUNNER_TEMP" "$state_argument" <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const root = fs.realpathSync(process.argv[2])
const state = path.resolve(process.argv[3])
if (path.dirname(state) !== root || (fs.existsSync(state) && fs.realpathSync(state) !== state))
  throw new Error('State must be a direct, non-symlink child of RUNNER_TEMP')
process.stdout.write(state)
JS
)
state_key=$(node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$state")
image='mcr.microsoft.com/playwright@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f'
starting=false

stop_container() {
  local cid inspection remaining status=0
  [ -f "$state/cid" ] || return 0
  cid=$(< "$state/cid")
  if ! [[ "$cid" =~ ^[0-9a-f]{64}$ ]]; then
    echo 'Refusing to stop an invalid container ID.' >&2
    return 1
  fi
  if ! inspection=$(docker container inspect "$cid" 2> "$state/inspect-error.log"); then
    remaining=$(docker container ls --all --no-trunc --filter "id=$cid" --format '{{.ID}}') || return 1
    [ -z "$remaining" ] && return 0
    cat "$state/inspect-error.log" >&2
    return 1
  fi
  if ! jq -e --arg repository "$GITHUB_REPOSITORY" --arg run "$GITHUB_RUN_ID" \
    --arg attempt "$GITHUB_RUN_ATTEMPT" --arg job "$GITHUB_JOB" --arg state "$state_key" \
    '.[0].Config.Labels | .["com.sim.ci.playwright-server"] == "true"
      and .["com.sim.ci.repository"] == $repository and .["com.sim.ci.run"] == $run
      and .["com.sim.ci.attempt"] == $attempt and .["com.sim.ci.job"] == $job
      and .["com.sim.ci.state"] == $state' <<< "$inspection" > /dev/null; then
    echo 'Refusing to stop a container owned by another job or state directory.' >&2
    return 1
  fi
  docker stop --timeout 10 "$cid" > "$state/stop.log" 2>&1 || status=1
  docker logs "$cid" > "$state/server.log" 2>&1 || status=1
  docker rm "$cid" > "$state/remove.log" 2>&1 || status=1
  return "$status"
}

trap '
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$starting" = true ]; then
    stop_container || echo "Owned Playwright server cleanup failed; preserve its state and logs." >&2
  fi
  exit "$status"
' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$action" = stop ]; then
  stop_container
  exit 0
fi
if [ -e "$state/cid" ]; then
  echo 'Refusing to reuse an existing Playwright server state.' >&2
  exit 1
fi
mkdir -p -- "$state"
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
driver=$(node - "$repo_root/apps/sim" <<'JS'
const fs = require('node:fs')
const path = require('node:path')
const packagePath = require.resolve('playwright-core/package.json', { paths: [process.argv[2]] })
const root = fs.realpathSync(path.dirname(packagePath))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'browsers.json'), 'utf8'))
if (JSON.parse(fs.readFileSync(packagePath, 'utf8')).version !== '1.64.1' ||
    manifest.browsers.find(browser => browser.name === 'webkit')?.revision !== '2370')
  throw new Error('The pinned WebKit image requires Playwright 1.64.1, revision 2370')
process.stdout.write(root)
JS
)
docker pull "$image" > "$state/pull.log" 2>&1
starting=true
docker run --detach --init --cidfile "$state/cid" \
  --name "sim-ci-playwright-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$GITHUB_JOB-$$" \
  --label com.sim.ci.playwright-server=true --label "com.sim.ci.repository=$GITHUB_REPOSITORY" \
  --label "com.sim.ci.run=$GITHUB_RUN_ID" --label "com.sim.ci.attempt=$GITHUB_RUN_ATTEMPT" \
  --label "com.sim.ci.job=$GITHUB_JOB" --label "com.sim.ci.state=$state_key" \
  --network host --cpus 8 --memory 4g --memory-swap 4g --pids-limit 512 --shm-size 256m \
  --mount "type=bind,src=$driver,dst=/opt/playwright-core,readonly" \
  "$image" node /opt/playwright-core/cli.js run-server --host 127.0.0.1 --port 0 \
  > "$state/start.log" 2>&1
cid=$(< "$state/cid")
if ! [[ "$cid" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Docker did not return a complete container ID.' >&2
  exit 1
fi
docker container inspect "$cid" > "$state/metadata.json"
deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$deadline" ]; do
  live=$(docker container inspect --format '{{.State.Running}} {{.State.Pid}}' "$cid")
  if ! [[ "$live" =~ ^true\ [1-9][0-9]*$ ]]; then
    docker logs "$cid" > "$state/server.log" 2>&1
    echo 'Playwright server exited before readiness.' >&2
    exit 1
  fi
  docker logs "$cid" > "$state/server.log" 2>&1
  endpoint=$(sed -n 's@^Listening on \(ws://127\.0\.0\.1:[1-9][0-9]*/\)$@\1@p' "$state/server.log")
  if [ -n "$endpoint" ]; then
    node - "$endpoint" <<'JS'
const endpoint = process.argv[2]
if (!/^ws:\/\/127\.0\.0\.1:[1-9]\d*\/$/.test(endpoint)) throw new Error('Invalid server endpoint')
new URL(endpoint)
process.stdout.write(`${endpoint}\n`)
JS
    exit 0
  fi
  sleep 0.1
done
echo 'Playwright server did not report a live loopback endpoint within 30 seconds.' >&2
exit 1
