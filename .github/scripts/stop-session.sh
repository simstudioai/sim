#!/usr/bin/env bash
# Stops every process in a session started with `setsid`, and returns only once none is left.
#
# Usage: stop-session.sh <session-leader-pid>
#
# `next dev` runs its server and workers as child processes. Waiting on `next dev` alone returns
# while those can still be running, and the next app in the job reuses the same .next directory.
# Every member of the session is signalled, including one that moved to its own process group,
# and one that started after the first signal.
#
# Zombies don't count as running: they have exited and only await reaping. The leader is one
# until the shell that started it waits on it, which that shell does after this returns.
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

# Centiseconds since boot: monotonic, and independent of the locale's decimal separator.
now_cs() {
  local uptime
  read -r uptime _ < /proc/uptime
  echo "${uptime/./}"
}

# Re-sends the signal every 0.1s while the check holds, until the shared deadline.
# Succeeds once the check stops holding.
signal_while() {
  local signal=$1
  shift
  while ((10#$(now_cs) < deadline)); do
    "$@" || return 0
    signal_session "$signal"
    sleep 0.1
  done
  ! "$@"
}

deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while TERM leader_running
if ! leader_running && running; then
  echo "Processes from session $leader outlived its leader:"
  ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
fi
signal_while TERM running && exit 0

echo "::warning::Processes from session $leader were still running ${grace_seconds}s after SIGTERM:"
ps -s "$leader" -o pid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while KILL running && exit 0

echo "::error::Processes from session $leader survived SIGKILL for ${grace_seconds}s."
exit 1
