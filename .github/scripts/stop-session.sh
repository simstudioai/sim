#!/usr/bin/env bash
# Stops every process an app started, and returns only once none is left.
#
# Usage: stop-session.sh <session-leader-pid> <app-tag>
#
# Start the app as `E2E_APP=<app-tag> setsid <command> &`, with a tag no other process of this
# user carries (CI uses `<app>-<run id>-<attempt>-<shell pid>`). Its processes are the members of
# the leader's session, plus any process whose environment holds exactly `E2E_APP=<app-tag>` but
# left the session. This script, its ancestors and its own children are never signalled, even
# when they carry the tag.
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

# Sets `state` and `parent` from /proc/<pid>/stat without forking, so a scan stays cheap, and
# fails once the process is gone. The command name can hold spaces and parentheses, so the
# fields are read after its last ")".
read_stat() {
  local stat rest
  read -r stat < "/proc/$1/stat" 2>/dev/null || return 1
  rest=${stat##*") "}
  state=${rest%% *}
  rest=${rest#* }
  parent=${rest%% *}
}

ancestors=" "
pid=$$
while read_stat "$pid" && [ "$parent" -gt 0 ]; do
  ancestors+="$parent "
  pid=$parent
  [ "$pid" -eq 1 ] && break
done

# This script, an ancestor of it, or one of its own subshells and commands, which inherit the tag
# when the caller exported it. A process whose ancestry vanished mid-walk is left to the next scan.
is_own() {
  local pid=$1
  [[ "$ancestors" == *" $pid "* ]] && return 0
  while [ "$pid" -gt 1 ]; do
    [ "$pid" -eq $$ ] && return 0
    read_stat "$pid" || return 0
    pid=$parent
  done
  return 1
}

app_pids() {
  local pid
  {
    ps -s "$leader" -o pid= 2>/dev/null
    grep -Flzx "E2E_APP=$tag" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3
  } | sort -u | while read -r pid; do
    read_stat "$pid" || continue
    [ "$state" = Z ] && continue
    is_own "$pid" || echo "$pid"
  done
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
  [ -z "$pids" ] && return
  ps -p "$pids" -o pid,sid,stat,etimes,args 2>/dev/null |
    awk '/next\/dist\/telemetry\/detached-flush\.js/ { print "(expected telemetry flush) " $0; next } { print }' |
    cut -c1-220 || true
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
