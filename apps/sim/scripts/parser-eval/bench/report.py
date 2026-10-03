#!/usr/bin/env python
"""Prints per-extension counts, bytes, and reference-error counts from manifest.json."""
import collections, json, os
BENCH = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(os.path.join(BENCH, "manifest.json")))
cnt, byt, err = collections.Counter(), collections.Counter(), collections.Counter()
for e in m:
    cnt[e["ext"]] += 1; byt[e["ext"]] += e["size"]
    rp = os.path.join(BENCH, "reference", os.path.basename(e["file"]) + ".json")
    if os.path.exists(rp):
        r = json.load(open(rp))
        if "error" in r or any(k.endswith("_error") for k in r): err[e["ext"]] += 1
    else:
        err[e["ext"]] += 1
print(f"{'ext':6} {'files':>6} {'bytes':>12} {'ref_err':>8}")
for ext in sorted(cnt):
    print(f"{ext:6} {cnt[ext]:6} {byt[ext]:12,} {err[ext]:8}")
print(f"{'TOTAL':6} {sum(cnt.values()):6} {sum(byt.values()):12,} {sum(err.values()):8}")
