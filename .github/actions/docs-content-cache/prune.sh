#!/usr/bin/env bash
set -euo pipefail

case ${1:-} in
  content)
    cache=apps/docs/.content
    maximum_kilobytes=524288
    ;;
  next)
    cache=apps/docs/.next/cache
    maximum_kilobytes=2097152
    ;;
  *) echo 'Usage: prune.sh <content|next>' >&2; exit 2 ;;
esac
if [ ! -d "$cache" ]; then exit 0; fi
if [ "$1" = next ]; then find "$cache" -type f -mtime +7 -delete; fi
kilobytes=$(du -sk "$cache" | awk '{ print $1 }')
if [ "$kilobytes" -gt "$maximum_kilobytes" ]; then
  find "$cache" -mindepth 1 -delete
fi
