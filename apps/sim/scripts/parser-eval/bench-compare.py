"""Compares two bench-run output directories file by file and applies a strict regression gate.
Usage: bench-compare.py <bench-dir> <before-out> <after-out> [report.md]
"""
import json, os, re, statistics, sys, unicodedata
from collections import Counter, defaultdict
from rapidfuzz import fuzz

BENCH, BEFORE, AFTER = sys.argv[1:4]
REPORT = sys.argv[4] if len(sys.argv) > 4 else os.path.join(BENCH, 'compare.md')
REF = os.path.join(BENCH, 'reference')
WORD = re.compile(r'\w+', re.UNICODE)
NEEDLE_CAP, HAY_CAP, LINE_CAP = 160, 400_000, 300
PAGE_NUM = re.compile(r'^(page\s*)?\d{1,4}(\s*(of|/)\s*\d{1,4})?$', re.I)
# Extensions whose ok->error flips are intended: legacy .ppt now refuses with a typed error.
INTENDED_ERROR_EXTS = {'ppt'}

def norm(t):
  t = unicodedata.normalize('NFKC', t or '').replace('­', '').replace('‑', '-').lower()
  return re.sub(r'\s+', ' ', t).strip()
def vocab(t): return {w for w in WORD.findall(norm(t)) if len(w) >= 2}
def found(needle, hay):
  n = norm(needle)[:NEEDLE_CAP]
  if not n: return False
  if n in hay: return True
  return fuzz.partial_ratio(n, hay[:HAY_CAP], score_cutoff=90) >= 90
def blocks(t): return [l.strip() for l in (t or '').split('\n') if l.strip()]
def junk_per_1k(t):
  bad = sum(1 for ch in t if (unicodedata.category(ch) in ('Cc', 'Co', 'Cn') and ch not in '\n\t\r') or ch in '�­')
  return round(1000 * bad / max(1, len(t)), 2)
def r(x): return None if x is None else round(x, 4)

def load_ref(label):
  p = os.path.join(REF, label.split('__', 1)[1] + '.json')
  if not os.path.exists(p): return {}
  j = json.load(open(p))
  return {k: v for k, v in j.items() if isinstance(v, str) and k != 'error' and v.strip()}

def metrics(rec, refs):
  if not rec['ok']:
    return dict(ok=False, typed=bool(rec.get('typedError')), code=rec.get('errorCode') or rec.get('errorName'), error=rec.get('error', '')[:120], degraded=False)
  out = rec['content']; n_out = norm(out)
  m = dict(ok=True, typed=None, degraded=bool(rec['metadata'].get('degraded')), truncated=bool(rec['metadata'].get('truncated')), length=len(out), lines=len(blocks(out)), chunks=rec.get('chunkCount'), ms=rec['ms'], junk=junk_per_1k(out), detected=rec['metadata'].get('detectedType'), method=rec['metadata'].get('extractionMethod'), encoding=rec['metadata'].get('encoding'))
  line_counts = Counter(norm(l) for l in blocks(out) if 0 < len(l) <= 120)
  m['repeated_lines'] = sum(c - 1 for c in line_counts.values() if c >= 3)
  m['page_number_lines'] = sum(1 for l in blocks(out) if PAGE_NUM.match(l))
  ref_vocab = set(); recalls = []; precisions = []
  for name, text in refs.items():
    n_ref = norm(text); ref_vocab |= vocab(text)
    ref_lines = [l for l in blocks(text) if len(l) >= 25][:LINE_CAP]
    out_lines = [l for l in blocks(out) if len(l) >= 25][:LINE_CAP]
    if ref_lines: recalls.append(sum(found(l, n_out) for l in ref_lines) / len(ref_lines))
    if out_lines: precisions.append(sum(found(l, n_ref) for l in out_lines) / len(out_lines))
  m['recall'] = r(max(recalls)) if recalls else None
  m['precision'] = r(max(precisions)) if precisions else None
  if ref_vocab:
    words = [w for w in WORD.findall(n_out) if len(w) >= 2]
    noise = [w for w in words if w not in ref_vocab]
    m['noise'] = r(len(noise) / max(1, len(words)))
    m['glued'] = len({w for w in set(noise) if len(w) >= 6 and any(w[:i] in ref_vocab and w[i:] in ref_vocab and i >= 2 and len(w) - i >= 2 for i in range(2, len(w) - 1))})
    m['ref_vocab_recall'] = r(len(set(words) & ref_vocab) / max(1, len(ref_vocab)))
  return m

rows = []
labels = sorted(set(os.listdir(BEFORE)) & set(os.listdir(AFTER)))
for f in labels:
  if f.startswith('_'): continue
  b = json.load(open(os.path.join(BEFORE, f))); a = json.load(open(os.path.join(AFTER, f)))
  refs = load_ref(b['label'])
  mb, ma = metrics(b, refs), metrics(a, refs)
  flags = []
  if mb['ok'] and not ma['ok']:
    if b['ext'] in INTENDED_ERROR_EXTS or (mb.get('degraded') and ma.get('typed')): flags.append('intended:ok->typed-error')
    elif ma.get('typed'): flags.append('REGRESSION:ok->error')
    else: flags.append('REGRESSION:ok->untyped-error')
  if not mb['ok'] and ma['ok']: flags.append('improved:error->ok')
  if not mb['ok'] and not ma['ok'] and not mb.get('typed') and ma.get('typed'): flags.append('improved:untyped->typed')
  if mb['ok'] and ma['ok']:
    if mb.get('recall') is not None and ma.get('recall') is not None and ma['recall'] < mb['recall'] - 0.02: flags.append(f"REGRESSION:recall {mb['recall']}->{ma['recall']}")
    if mb.get('ref_vocab_recall') is not None and ma.get('ref_vocab_recall') is not None and ma['ref_vocab_recall'] < mb['ref_vocab_recall'] - 0.02: flags.append(f"REGRESSION:vocab-recall {mb['ref_vocab_recall']}->{ma['ref_vocab_recall']}")
    if mb.get('noise') is not None and ma.get('noise') is not None and ma['noise'] > mb['noise'] + 0.02: flags.append(f"REGRESSION:noise {mb['noise']}->{ma['noise']}")
    if mb.get('glued') is not None and ma.get('glued', 0) > mb.get('glued', 0): flags.append(f"REGRESSION:glued {mb['glued']}->{ma['glued']}")
    if ma['junk'] > mb['junk'] + 0.5: flags.append(f"REGRESSION:junk {mb['junk']}->{ma['junk']}")
    if not mb['degraded'] and ma['degraded']: flags.append('REGRESSION:now-degraded')
    if ma['ms'] > 3 * mb['ms'] and ma['ms'] - mb['ms'] > 500: flags.append(f"SLOWER:{mb['ms']:.0f}->{ma['ms']:.0f}ms")
    if ma['length'] < 0.8 * mb['length'] and mb['length'] > 200 and (mb.get('recall') is None or ma.get('recall') is None): flags.append(f"CHECK:length {mb['length']}->{ma['length']} (no reference)")
  rows.append(dict(label=b['label'], ext=b['ext'], before=mb, after=ma, flags=flags))

json.dump(rows, open(os.path.join(BENCH, 'compare.json'), 'w'), indent=1)

def mean(xs):
  xs = [x for x in xs if isinstance(x, (int, float)) and not isinstance(x, bool)]
  return f'{statistics.mean(xs):.3f}' if xs else '—'
by_ext = defaultdict(list)
for row in rows: by_ext[row['ext']].append(row)
cols = ['recall', 'ref_vocab_recall', 'precision', 'noise', 'glued', 'lines', 'repeated_lines', 'page_number_lines', 'junk', 'chunks', 'ms']
L = ['# Before/after benchmark', '', f'{len(rows)} files compared. Gate: recall −0.02, vocab recall −0.02, noise +0.02, glued +1, junk +0.5, ok→error (except intended), now-degraded.', '']
regressions = [x for x in rows if any(f.startswith('REGRESSION') for f in x['flags'])]
L += [f"**Regressions: {len(regressions)}**", '']
L += ['| ext | n | ok before→after | typed errors b→a | degraded b→a | ' + ' | '.join(f'{c} b→a' for c in cols) + ' |', '|' + '---|' * (len(cols) + 5)]
for ext in sorted(by_ext):
  rs = by_ext[ext]; bs = [x['before'] for x in rs]; as_ = [x['after'] for x in rs]
  cells = [f"{mean([b.get(c) for b in bs])}→{mean([a.get(c) for a in as_])}" for c in cols]
  L.append(f"| {ext} | {len(rs)} | {sum(b['ok'] for b in bs)}→{sum(a['ok'] for a in as_)} | {sum(1 for b in bs if not b['ok'] and b.get('typed'))}→{sum(1 for a in as_ if not a['ok'] and a.get('typed'))} | {sum(1 for b in bs if b.get('degraded'))}→{sum(1 for a in as_ if a.get('degraded'))} | " + ' | '.join(cells) + ' |')
L += ['', '## Flags per file', '', '| file | flags |', '|---|---|']
for row in rows:
  if row['flags']: L.append(f"| {row['label']} | {'; '.join(row['flags'])} |")
open(REPORT, 'w').write('\n'.join(L) + '\n')
print('\n'.join(L[:8 + len(by_ext)]))
print(f"\nregressions={len(regressions)} flagged={sum(1 for x in rows if x['flags'])} report={REPORT}")
