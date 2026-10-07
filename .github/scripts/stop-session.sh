#!/usr/bin/env bash
# Stops every process an app started, and returns only once none is left.
#
# Usage: stop-session.sh <session-leader-pid> <app-tag>
#
# Start the app as `E2E_APP=<app-tag> setsid <command> &`. Its processes are the members of the
# leader's session, plus any process that inherited `E2E_APP=<app-tag>` but left the session.
# `next dev` needs both: its server and workers stay in the session, while its telemetry flush is
# spawned detached, in a session of its own, and writes .next/dev/trace after `next dev` exits.
# The next app in the job wipes that directory, so it must not start while any of them runs.
#
# Every member is signalled, including one that moved to its own process group, and one that
# started after the first signal.
#
# Zombies don't count as running: they have exited and only await reaping. The leader is one
# until the shell that started it waits on it, which that shell does after this returns.
set -u

leader=$1
tag=$2
grace_seconds=10

app_pids() {
  {
    ps -s "$leader" -o pid=,stat= 2>/dev/null | awk '$2 !~ /^Z/ { print $1 }'
    grep -lzx "E2E_APP=$tag" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3
  } | sort -u
}

signal_app() {
  local pids
  pids=$(app_pids)
  [ -z "$pids" ] || kill "-$1" $pids 2>/dev/null || true
}

running() {
  [ -n "$(app_pids)" ]
}

leader_running() {
  ps -p "$leader" -o stat= 2>/dev/null | grep -qv '^Z'
}

list_app() {
  local pids
  pids=$(app_pids | paste -sd, -)
  [ -z "$pids" ] || ps -p "$pids" -o pid,sid,stat,etimes,args 2>/dev/null | cut -c1-200 || true
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
    signal_app "$signal"
    sleep 0.1
  done
  ! "$@"
}

deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while TERM leader_running
if ! leader_running && running; then
  echo "Processes from app $tag outlived its leader:"
  list_app
fi
signal_while TERM running && exit 0

echo "::warning::Processes from app $tag were still running ${grace_seconds}s after SIGTERM:"
list_app
deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while KILL running && exit 0

echo "::error::Processes from app $tag survived SIGKILL for ${grace_seconds}s."
exit 1
