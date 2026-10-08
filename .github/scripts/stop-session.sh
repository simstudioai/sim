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

leader=${1:-}
tag=${2:-}
grace_seconds=10

if ! [[ "$leader" =~ ^[0-9]+$ ]] || [ -z "$tag" ]; then
  echo "::error::Usage: stop-session.sh <session-leader-pid> <app-tag>, with a non-empty tag." >&2
  exit 2
fi

# Sets `state` and `parent` from /proc/<pid>/stat without forking, so a scan stays cheap, and
# fails once the process is gone. The command name can hold spaces and parentheses, so the
# fields are read after its last ")".
read_stat() {
  local stat rest
  read -r stat 2>/dev/null < "/proc/$1/stat" || return 1
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
# when the caller exported it. When a process on the walk exits mid-walk, the candidate has been
# reparented, so the walk restarts from it; ancestry that still won't resolve counts as not ours,
# so an app process is never spared by accident.
is_own() {
  local candidate=$1 pid attempt
  [[ "$ancestors" == *" $candidate "* ]] && return 0
  for attempt in 1 2 3; do
    pid=$candidate
    while [ "$pid" -gt 1 ]; do
      [ "$pid" -eq $$ ] && return 0
      read_stat "$pid" || continue 2
      pid=$parent
    done
    return 1
  done
  return 1
}

app_pids() {
  local pid
  {
    ps -s "$leader" -o pid= 2>/dev/null | tr -d ' '
    grep -Flzx "E2E_APP=$tag" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3
  } | sort -nu | while read -r pid; do
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

# Prints one scan of the app's processes as a table, the expected telemetry flush labelled in a
# leading column, and fails when that scan finds none, so no caller prints an empty heading.
describe_app() {
  local pids table
  pids=$(app_pids | paste -sd, -)
  [ -n "$pids" ] || return 1
  table=$(ps -p "$pids" -o pid,sid,stat,etimes,args 2>/dev/null)
  [ "$(wc -l <<< "$table")" -gt 1 ] || return 1
  awk '{
    note = ""
    if (NR > 1 && $0 ~ /next\/dist\/telemetry\/detached-flush\.js/) note = "(expected telemetry flush)"
    printf "%-26s %s\n", note, $0
  }' <<< "$table" | cut -c1-240
}

# Centiseconds since boot: monotonic, and independent of the locale's decimal separator.
now_cs() {
  local uptime
  read -r uptime _ < /proc/uptime
  echo "${uptime/./}"
}

# Re-sends the signal every 0.1s while the check holds, until the shared deadline. Succeeds
# once the check has stopped holding on two scans 0.1s apart, so a process missed by one scan
# (spawned, or mid-reparenting, while it ran) is still caught.
signal_while() {
  local signal=$1 clear=0
  shift
  while ((10#$(now_cs) < deadline)); do
    if "$@"; then
      clear=0
      signal_app "$signal"
    else
      clear=$((clear + 1))
      ((clear >= 2)) && return 0
    fi
    sleep 0.1
  done
  "$@" && return 1
  sleep 0.1
  ! "$@"
}

deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while TERM leader_running
if ! leader_running && table=$(describe_app); then
  echo "Processes from app $tag outlived its leader:"
  echo "$table"
fi
signal_while TERM running && exit 0

echo "::warning::Processes from app $tag were still running ${grace_seconds}s after SIGTERM:"
describe_app || true
deadline=$((10#$(now_cs) + grace_seconds * 100))
signal_while KILL running && exit 0

echo "::error::Processes from app $tag survived SIGKILL for ${grace_seconds}s."
exit 1
