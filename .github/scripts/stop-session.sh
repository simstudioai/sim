#!/usr/bin/env bash
# Stops every process in a session started with `setsid`, and returns only once none is left.
#
# Usage: stop-session.sh <session-leader-pid>
#
# `next dev` runs its server and workers as child processes. Waiting on `next dev` alone returns
# while those can still be running, and the next app in the job reuses the same .next directory.
# Every member of the session is signalled, including one that moved to its own process group.
# The leader stays a zombie until the shell that started it waits on it, so zombies don't count.
set -u

leader=$1
grace_seconds=10

session_pids() {
  ps -s "$leader" -o pid=,stat= 2>/dev/null | awk '$2 !~ /^Z/ { print $1 }'
}

signal_session() {
  local pids
  pids=$(session_pids)
  [ -z "$pids" ] || kill "-$1" $pids 2>/dev/null || true
}

running() {
  [ -n "$(session_pids)" ]
}

leader_running() {
  ps -p "$leader" -o stat= 2>/dev/null | grep -qv '^Z'
}

now_us() {
  echo "${EPOCHREALTIME/./}"
}

# Waits while the given check holds, until the shared deadline. Succeeds once it stops holding.
wait_while() {
  while (($(now_us) < deadline)); do
    "$@" || return 0
    sleep 0.1
  done
  ! "$@"
}

deadline=$(($(now_us) + grace_seconds * 1000000))
signal_session TERM
wait_while leader_running
if ! leader_running && running; then
  echo "Processes from session $leader outlived its leader:"
  ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
fi
wait_while running && exit 0

echo "::warning::Processes from session $leader were still running ${grace_seconds}s after SIGTERM:"
ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
deadline=$(($(now_us) + grace_seconds * 1000000))
signal_session KILL
wait_while running && exit 0

echo "::error::Processes from session $leader survived SIGKILL for ${grace_seconds}s."
exit 1
