#!/usr/bin/env bash
# Samples macOS memory pressure, swap and the largest processes every 30 seconds into $1.
set -u
out="$1"
mkdir -p "$(dirname "$out")"
while true; do
  {
    echo "== $(date -u +%FT%TZ)"
    sysctl -n vm.swapusage
    memory_pressure -Q | tail -1
    vm_stat | grep -E 'Pages (free|active|wired|occupied by compressor)|Swapins|Swapouts'
    ps -Ao rss=,comm= | sort -rn | head -5
  } >>"$out" 2>&1
  sleep 30
done
