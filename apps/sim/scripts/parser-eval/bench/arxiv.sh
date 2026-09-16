#!/bin/bash
# Sequential, 1 req/s: query arXiv API per category, download ~50 PDFs total into files/pdf/arxiv__<id>.pdf
BENCH="$(cd "$(dirname "$0")" && pwd)"; source "$BENCH/lib.sh"
P="$BENCH/lists/plan_arxiv.tsv"; : > "$P"
for cat in cs.CL cs.LG math.ST q-bio.NC econ.EM physics.optics stat.ME cs.CV; do
  curl -sSL -f -A "$UA" "https://export.arxiv.org/api/query?search_query=cat:$cat&max_results=7&start=300&sortBy=submittedDate&sortOrder=descending" \
    | grep -o '<id>http://arxiv.org/abs/[^<]*</id>' | sed 's#.*/abs/##; s#</id>##; s/v[0-9]*$//' \
    | while read -r id; do printf 'https://arxiv.org/pdf/%s\tpdf\tarxiv__%s.pdf\thttps://arxiv.org/abs/%s\n' "$id" "${id//\//_}" "$id" >> "$P"; done
  sleep 1
done
sort -u "$P" -o "$P"; wc -l "$P"
while IFS=$'\t' read -r u e n s; do dl "$u" "$e" "$n" "$s"; sleep 1; done < "$P"
