#!/usr/bin/env bash
# Stops every process in a session started with `setsid`, and returns only once none is left.
#
# Usage: stop-session.sh <session-leader-pid>
#
# `next dev` runs its server and workers as child processes. Waiting on `next dev` alone returns
# while those can still be running, and the next app in the job reuses the same .next directory.
# The leader stays a zombie until the shell that started it waits on it, so zombies don't count.
set -u

leader=$1

running() {
  ps -s "$leader" -o pid=,stat= 2>/dev/null | awk '$2 !~ /^Z/ { found = 1 } END { exit !found }'
}

leader_running() {
  ps -p "$leader" -o stat= 2>/dev/null | grep -qv '^Z'
}

wait_for() {
  for _ in $(seq 1 100); do
    "$@" || return 0
    sleep 0.1
  done
  return 1
}

kill -TERM -- "-$leader" 2>/dev/null || true
wait_for leader_running
if running; then
  echo "Processes from session $leader outlived its leader:"
  ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
fi
wait_for running && exit 0

echo "::warning::Processes from session $leader were still running 10s after SIGTERM:"
ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null || true
kill -KILL -- "-$leader" 2>/dev/null || true
wait_for running && exit 0

echo "::error::Processes from session $leader survived SIGKILL."
exit 1
