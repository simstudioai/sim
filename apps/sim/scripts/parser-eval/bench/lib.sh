# Shared helpers for build.sh (sourced). BENCH must be set.
set -u
MAX_BYTES=$((25*1024*1024))
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) sim-kb-parser-bench/1.0 (contact: waleed@sim.ai)'

# ls_gh owner/repo path -> "download_url<TAB>name<TAB>size" (files only)
ls_gh(){ gh api "repos/$1/contents/$2" --paginate --jq '.[] | select(.type=="file") | [.download_url, .name, (.size|tostring)] | @tsv' 2>/dev/null; }

# pick EXT N TAG < tsv  -> plan lines "url<TAB>ext<TAB>tag__name<TAB>source". Evenly spaced pick, size-filtered.
pick(){ awk -F'\t' -v e="$1" -v n="$2" -v tag="$3" -v max="$MAX_BYTES" '
  tolower($2) ~ ("\\." e "$") && $3+0 > 0 && $3+0 <= max { u[++c]=$1; nm[c]=$2 }
  END { if(c==0) exit; step=(c>n)? c/n : 1; for(i=1; i<=c && k<n; i+=step){ j=int(i); k++; name=nm[j]; gsub(/[^A-Za-z0-9._-]/,"_",name); print u[j] "\t" e "\t" tag "__" name "\t" u[j] } }'; }

# dl url ext name source  (one line of plan). Writes files/<ext>/<name>, appends to lists/fetched.tsv or lists/failed.tsv
dl(){
  local url="$1" ext="$2" name="$3" out="$BENCH/files/$2/$3"
  mkdir -p "$BENCH/files/$ext"
  [ -s "$out" ] && { echo -e "$url\t$ext\t$name\t$(stat -f%z "$out")" >> "$BENCH/lists/fetched.tsv"; return 0; }
  if curl -sSL -f --retry 2 --max-time 120 -A "$UA" --max-filesize $MAX_BYTES -o "$out.part" "$url" 2>>"$BENCH/lists/curl_errors.log"; then
    local sz; sz=$(stat -f%z "$out.part" 2>/dev/null || echo 0)
    if [ "$sz" -gt 0 ] && [ "$sz" -le "$MAX_BYTES" ]; then mv "$out.part" "$out"; echo -e "$url\t$ext\t$name\t$sz" >> "$BENCH/lists/fetched.tsv"; return 0; fi
    rm -f "$out.part"; echo -e "$url\t$ext\t$name\tbad_size:$sz" >> "$BENCH/lists/failed.tsv"; return 1
  fi
  rm -f "$out.part"; echo -e "$url\t$ext\t$name\thttp_error" >> "$BENCH/lists/failed.tsv"; return 1
}
export -f dl; export BENCH MAX_BYTES UA
