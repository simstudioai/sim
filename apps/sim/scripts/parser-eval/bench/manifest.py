#!/usr/bin/env python
"""Builds bench/manifest.json from files/<ext>/* and the plan lists; removes sha256 duplicates, zero-byte and >25MB files."""
import hashlib, json, os, sys
BENCH = os.path.dirname(os.path.abspath(__file__))
MAX = 25 * 1024 * 1024
src = {}
for name in os.listdir(os.path.join(BENCH, "lists")):
    if name.startswith("plan_") and name.endswith(".tsv"):
        for line in open(os.path.join(BENCH, "lists", name), encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 4:
                src[(parts[1], parts[2])] = parts[3]
seen, manifest, removed = {}, [], []
for ext in sorted(os.listdir(os.path.join(BENCH, "files"))):
    d = os.path.join(BENCH, "files", ext)
    if not os.path.isdir(d):
        continue
    for fn in sorted(os.listdir(d)):
        p = os.path.join(d, fn)
        if fn.endswith(".part") or not os.path.isfile(p):
            continue
        size = os.path.getsize(p)
        if size == 0 or size > MAX:
            removed.append((fn, f"size={size}")); os.remove(p); continue
        h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        if h in seen:
            removed.append((fn, f"dup_of={seen[h]}")); os.remove(p)
            ref = os.path.join(BENCH, "reference", fn + ".json")
            if os.path.exists(ref): os.remove(ref)
            continue
        seen[h] = fn
        manifest.append({"file": f"files/{ext}/{fn}", "ext": ext, "source_url": src.get((ext, fn)) or ("https://arxiv.org/abs/" + fn[len("arxiv__"):-4] if fn.startswith("arxiv__") else ""), "size": size, "sha256": h})
json.dump(manifest, open(os.path.join(BENCH, "manifest.json"), "w"), indent=1)
with open(os.path.join(BENCH, "lists", "removed.tsv"), "w") as f:
    for fn, why in removed: f.write(f"{fn}\t{why}\n")
print(f"manifest: {len(manifest)} files, removed {len(removed)}")
