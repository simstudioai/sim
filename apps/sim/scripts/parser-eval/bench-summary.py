"""Renders the per-format summary table for BENCHMARK.md straight from compare.json so the
document can never drift from the comparer's own numbers.
Usage: bench-summary.py <bench-dir>
"""
import json, statistics, sys
from collections import defaultdict

rows = json.load(open(f'{sys.argv[1]}/compare.json'))
by_ext = defaultdict(list)
for row in rows: by_ext[row['ext']].append(row)

def mean(side, key):
  xs = [r[side].get(key) for r in rs if isinstance(r[side].get(key), (int, float)) and not isinstance(r[side].get(key), bool)]
  return statistics.mean(xs) if xs else None
def cell(key, digits=3):
  b, a = mean('before', key), mean('after', key)
  if b is None and a is None: return '—'
  fmt = lambda x: '—' if x is None else (f'{x:.{digits}f}' if digits else f'{x:.0f}')
  return f'{fmt(b)}→{fmt(a)}'

print('| ext | n | ok b→a | recall b→a | vocab b→a | noise b→a | glued b→a | lines b→a | ms b→a |')
print('|---|---|---|---|---|---|---|---|---|')
for ext in sorted(by_ext):
  rs = by_ext[ext]
  ok = f"{sum(r['before']['ok'] for r in rs)}→{sum(r['after']['ok'] for r in rs)}"
  print(f"| {ext} | {len(rs)} | {ok} | {cell('recall')} | {cell('ref_vocab_recall')} | {cell('noise')} | {cell('glued', 2)} | {cell('lines', 0)} | {cell('ms', 0)} |")
flags = defaultdict(int)
for r in rows:
  for f in r['flags']: flags[f.split(' ')[0].split(':')[0] + ':' + f.split(' ')[0].split(':')[1] if ':' in f.split(' ')[0] else f] += 1
print()
print('| flag | files |'); print('|---|---|')
for k, v in sorted(flags.items()): print(f'| {k} | {v} |')
