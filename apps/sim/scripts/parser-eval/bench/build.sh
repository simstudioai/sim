#!/bin/bash
# Reproducible build of the KB-parser benchmark corpus.
#   ./build.sh            -> plan + fetch + arxiv + manifest + reference + report
#   ./build.sh fetch|reference|manifest|report  -> single stage
set -u
BENCH="$(cd "$(dirname "$0")" && pwd)"; cd "$BENCH"; source "$BENCH/lib.sh"
PY="${PARSER_EVAL_PYTHON:-$BENCH/../refenv/bin/python}"
stage=${1:-all}
if [ "$stage" = all ] || [ "$stage" = fetch ]; then
  ./plan_office.sh; ./plan_web.sh
  ./fetch.sh lists/plan_office.tsv 8 &
  ./fetch.sh lists/plan_web.tsv 6 &
  ./arxiv.sh &           # sequential, 1 req/s
  wait
  ./postprocess.sh        # Latin-1 re-encoded Gutenberg variants
fi
if [ "$stage" = all ] || [ "$stage" = manifest ]; then "$PY" manifest.py; fi
if [ "$stage" = all ] || [ "$stage" = reference ]; then
  mkdir -p reference
  find files -type f ! -name '*.part' -print0 | xargs -0 -P 8 -n 5 "$PY" reference.py
fi
if [ "$stage" = all ] || [ "$stage" = report ]; then "$PY" report.py; fi
