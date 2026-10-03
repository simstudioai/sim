#!/bin/bash
# fetch.sh <plan.tsv> [parallelism]  -- downloads every plan line (url ext name source; no whitespace in fields) via dl()
BENCH="$(cd "$(dirname "$0")" && pwd)"; source "$BENCH/lib.sh"
P=${2:-8}
tr '\t' ' ' < "$1" | xargs -P "$P" -n 4 bash -c 'source "$BENCH/lib.sh"; dl "$@"' _
