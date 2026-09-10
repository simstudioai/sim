"""Scores parser outputs. Usage: score.py <corpus-dir>  → writes scores.json and report.md."""
import json, os, re, statistics, sys, unicodedata
from collections import defaultdict
from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

OUT = sys.argv[1]
OUTPUTS = os.path.join(OUT, 'outputs'); SPEC = os.path.join(OUT, 'spec'); REF = os.path.join(OUT, 'reference')
END_PUNCT = tuple('.!?:;)"”’\'')
WORD = re.compile(r'\w+', re.UNICODE)

def norm(t):
  t = unicodedata.normalize('NFKC', t or '').replace('­', '').replace('‑', '-').lower()
  return re.sub(r'\s+', ' ', t).strip()
def vocab(t): return {w for w in WORD.findall(norm(t)) if len(w) >= 2}
HAY_CAP = 300_000
NEEDLE_CAP = 160
def found(needle, hay, thr=90):
  n = norm(needle)[:NEEDLE_CAP]
  if not n: return False
  if n in hay: return True
  return fuzz.partial_ratio(n, hay[:HAY_CAP], score_cutoff=thr) >= thr
def position(needle, hay):
  n = norm(needle)[:NEEDLE_CAP]
  if not n: return None
  i = hay.find(n)
  if i >= 0: return i
  a = fuzz.partial_ratio_alignment(n, hay[:HAY_CAP], score_cutoff=90)
  return a.dest_start if a else None
def ned(a, b, cap=40_000):
  return r(Levenshtein.normalized_similarity(a[:cap], b[:cap]))
def junk_per_1k(t):
  bad = sum(1 for ch in t if (unicodedata.category(ch) in ('Cc', 'Co', 'Cn') and ch not in '\n\t\r') or ch in '�­')
  return round(1000 * bad / max(1, len(t)), 2)
def chunk_boundary(chunks):
  if len(chunks) <= 1: return None
  body = chunks[:-1]
  return round(sum(1 for c in body if c.rstrip().endswith(END_PUNCT)) / len(body), 3)
def blocks(t): return [l.strip() for l in t.split('\n') if l.strip()]
def r(x): return None if x is None else round(x, 3)

specs = {f[:-5]: json.load(open(os.path.join(SPEC, f))) for f in os.listdir(SPEC) if f.endswith('.json')}
gts = {f[:-7]: open(os.path.join(SPEC, f)).read() for f in os.listdir(SPEC) if f.endswith('.gt.txt')}

def score_tier_a(rec):
  spec = specs[rec['doc']]; gt = gts[rec['doc']]; out = rec['content']; n_out = norm(out); n_gt = norm(gt)
  sentinels = spec.get('firstSheetSentinels') if rec.get('firstSheetOnly') else spec['sentinels']
  pres = [found(s, n_out) for s in sentinels]
  absent = [not found(s, n_out, 85) for s in rec.get('absence') or []]
  pairs = []
  for a, b in spec['order_pairs']:
    pa, pb = position(a, n_out), position(b, n_out)
    if pa is not None and pb is not None: pairs.append(pa < pb)
  lines = [norm(l) for l in out.split('\n')]
  adj = []
  for a, b in spec['table_adjacency']:
    if rec.get('firstSheetOnly') and a not in (spec.get('firstSheetSentinels') or []): continue
    na, nb = norm(a), norm(b)
    adj.append(any(na in l and nb in l and l.find(na) < l.find(nb) for l in lines))
  gt_vocab = vocab(gt); out_words = [w for w in WORD.findall(n_out) if len(w) >= 2]
  noise = [w for w in out_words if w not in gt_vocab]
  def strip_marker(l): return re.sub(r'^(#{1,6}\s+|[•\-*]\s+|\d+\.\s+)', '', l.strip())
  heads = [any(norm(strip_marker(l)) == norm(h) for l in out.split('\n')) for h in spec['headings']]
  glued = [w for w in set(noise) if len(w) >= 6 and any(w[:i] in gt_vocab and w[i:] in gt_vocab and i >= 2 and len(w) - i >= 2 for i in range(2, len(w) - 1))]
  long_gt = {w for w in gt_vocab if len(w) >= 7}; out_vocab = vocab(out)
  missing_long = sorted(long_gt - out_vocab)
  is_sheet = spec.get('kind') == 'spreadsheet'
  return dict(
    ned=ned(n_out, n_gt),
    presence=r(sum(pres) / len(pres)) if pres else None,
    absence=r(sum(absent) / len(absent)) if absent else None,
    order=r(sum(pairs) / len(pairs)) if pairs else None,
    table_adjacency=r(sum(adj) / len(adj)) if adj else None,
    noise_ratio=r(len(noise) / max(1, len(out_words))), noise_sample=sorted(set(noise))[:12], glued_words=len(glued), glued_sample=sorted(glued)[:8],
    paragraph_retention=None if is_sheet else r(min(1.0, len(blocks(out)) / max(1, len(blocks(gt))))),
    heading_retention=r(sum(heads) / len(heads)) if heads else None,
    junk_per_1k=junk_per_1k(out), missing_long_words=missing_long[:10], missing_long_count=len(missing_long),
    chunk_sentence_boundary=None if is_sheet else chunk_boundary(rec['chunks']), chunk_count=len(rec['chunks']),
    degraded=bool(rec['metadata'].get('degraded')), truncated=bool(rec['metadata'].get('truncated')),
    length_ratio=r(len(n_out) / max(1, len(n_gt))), ms=round(rec['ms'], 1), bytes=rec['bytes'])

def score_tier_b(rec):
  refp = os.path.join(REF, rec['label'] + '.json'); pand = os.path.join(REF, rec['label'] + '.pandoc.txt')
  refs = {}
  if os.path.exists(refp):
    j = json.load(open(refp)); refs.update({k: v for k, v in j.items() if isinstance(v, str) and len(v) > 0})
    pages = j.get('pages'); slides = j.get('slides')
  else: pages = slides = None
  if os.path.exists(pand):
    t = open(pand).read()
    if t.strip(): refs['pandoc'] = t
  out = rec['content']; n_out = norm(out); res = dict(ms=round(rec['ms'], 1), bytes=rec['bytes'], length=len(out), degraded=bool(rec['metadata'].get('degraded')), truncated=bool(rec['metadata'].get('truncated')), junk_per_1k=junk_per_1k(out), chunk_sentence_boundary=chunk_boundary(rec['chunks']), chunk_count=len(rec['chunks']), refs={})
  if pages is not None: res['pageCount'] = rec['metadata'].get('pageCount'); res['ref_pages'] = pages
  ref_vocab = set()
  for name, text in refs.items():
    n_ref = norm(text); ref_vocab |= vocab(text)
    ref_lines = [l for l in blocks(text) if len(l) >= 25][:200]
    out_lines = [l for l in blocks(out) if len(l) >= 25][:200]
    recall = [found(l, n_out) for l in ref_lines]; precision = [found(l, n_ref) for l in out_lines]
    res['refs'][name] = dict(ned=ned(n_out, n_ref), ref_line_recall=r(sum(recall) / len(recall)) if recall else None, out_line_precision=r(sum(precision) / len(precision)) if precision else None, ref_length=len(n_ref))
  if ref_vocab:
    out_words = [w for w in WORD.findall(n_out) if len(w) >= 2]; noise = [w for w in out_words if w not in ref_vocab]
    res['noise_ratio'] = r(len(noise) / max(1, len(out_words))); res['noise_sample'] = sorted(set(noise))[:12]
    glued = [w for w in set(noise) if len(w) >= 6 and any(w[:i] in ref_vocab and w[i:] in ref_vocab and i >= 2 and len(w) - i >= 2 for i in range(2, len(w) - 1))]
    res['glued_words'] = len(glued); res['glued_sample'] = sorted(glued)[:8]
  return res

ROBUST_EXPECT = {
  'empty.docx': ('typed error', lambda rec: not rec['ok'] and rec.get('typedError')),
  'truncated-docx': ('typed error (invalid_format)', lambda rec: not rec['ok'] and rec.get('typedError')),
  'truncated-pdf': ('typed error (invalid_format)', lambda rec: not rec['ok'] and rec.get('typedError')),
  'pdf-bytes-labelled-docx': ('typed error OR correct text', lambda rec: (not rec['ok'] and rec.get('typedError')) or (rec['ok'] and 'Office Relocation' in rec['content'])),
  'docx-bytes-labelled-pdf': ('typed error OR correct text (magic wins)', lambda rec: (not rec['ok'] and rec.get('typedError')) or (rec['ok'] and 'Office Relocation' in rec['content'])),
  'png-labelled-doc': ('typed error, never placeholder prose', lambda rec: not rec['ok'] and rec.get('typedError')),
  'random-bytes-labelled-ppt': ('typed error, never placeholder prose', lambda rec: not rec['ok'] and rec.get('typedError')),
  'latin1-txt': ('text decodes to "Café résumé naïve £"', lambda rec: rec['ok'] and 'Café' in rec['content'] and '£' in rec['content']),
  'utf16-txt': ('text decodes to "Hello UTF-16 world"', lambda rec: rec['ok'] and 'Hello UTF-16 world' in rec['content']),
  'html-labelled-txt': ('markup stripped or typed error', lambda rec: (not rec['ok'] and rec.get('typedError')) or (rec['ok'] and '<html' not in rec['content'].lower())),
  'docx-labelled-xlsx': ('typed error OR correct text (magic wins)', lambda rec: (not rec['ok'] and rec.get('typedError')) or (rec['ok'] and 'Office Relocation' in rec['content'])),
  'csv-labelled-xlsx': ('typed error OR correct UTF-8 text', lambda rec: (not rec['ok'] and rec.get('typedError')) or (rec['ok'] and 'Araújo' in rec['content'] and 'Ã' not in rec['content'])),
  'docx-labelled-doc': ('correct text', lambda rec: rec['ok'] and 'Office Relocation' in rec['content'] and not rec['metadata'].get('degraded')),
  'pptx-labelled-ppt': ('typed unsupported_type (.ppt refused) OR correct text', lambda rec: (not rec['ok'] and rec.get('errorCode') == 'unsupported_type') or (rec['ok'] and 'Office Relocation' in rec['content'] and not rec['metadata'].get('degraded'))),
}

scores = {'A': {}, 'B': {}, 'R': {}}
for f in sorted(os.listdir(OUTPUTS)):
  rec = json.load(open(os.path.join(OUTPUTS, f)))
  if rec.get('tier') == 'R':
    name = rec['label'].replace('robust__', ''); expect, check = ROBUST_EXPECT[name]
    scores['R'][name] = dict(expected=expect, passed=bool(check(rec)), outcome=('ok %d chars%s' % (len(rec['content']), ' DEGRADED' if rec['metadata'].get('degraded') else '')) if rec['ok'] else ('%s: %s' % ('typed ' + str(rec.get('errorCode')) if rec.get('typedError') else 'UNTYPED', rec['error'][:90])), preview=(rec.get('content') or rec.get('error') or '')[:120])
  elif not rec['ok']:
    scores[rec['tier']][rec['label']] = dict(error=rec['error'][:160], typed=rec.get('typedError'), code=rec.get('errorCode'), format=rec['format'])
  elif rec['tier'] == 'A':
    s = score_tier_a(rec); s['format'] = rec['format']; s['variant'] = rec.get('variant'); s['doc'] = rec['doc']; scores['A'][rec['label']] = s
  else:
    s = score_tier_b(rec); s['format'] = rec['format']; scores['B'][rec['label']] = s
json.dump(scores, open(os.path.join(OUT, 'scores.json'), 'w'), indent=1, ensure_ascii=False)

# ---- report
def agg(rows, key):
  vals = [x[key] for x in rows if isinstance(x.get(key), (int, float)) and not isinstance(x.get(key), bool)]
  return f"{statistics.mean(vals):.2f}" if vals else '—'
by_fmt = defaultdict(list)
for label, s in scores['A'].items():
  if 'error' in s: continue
  key = s['format'] + ('-2col' if s.get('variant') == '2col' else '')
  by_fmt[key].append(s)
cols = ['ned', 'presence', 'absence', 'order', 'table_adjacency', 'noise_ratio', 'glued_words', 'paragraph_retention', 'heading_retention', 'chunk_sentence_boundary', 'junk_per_1k', 'ms']
lines = ['# Parser quality report', '', f"Tier A: {len(scores['A'])} files, Tier B: {len(scores['B'])} files, robustness: {len(scores['R'])} cases", '', '## Tier A — ground truth by construction (mean per format)', '', '| format | n | ' + ' | '.join(cols) + ' |', '|' + '---|' * (len(cols) + 2)]
for fmt in sorted(by_fmt): lines.append(f"| {fmt} | {len(by_fmt[fmt])} | " + ' | '.join(agg(by_fmt[fmt], c) for c in cols) + ' |')
lines += ['', '### Worst Tier A files by sentinel presence / adjacency / noise', '']
worst = sorted([(l, s) for l, s in scores['A'].items() if 'error' not in s], key=lambda x: ((x[1]['presence'] or 1), -(x[1]['noise_ratio'] or 0)))[:15]
lines += ['| file | presence | absence | order | adjacency | noise | para | heading | noise sample |', '|---|---|---|---|---|---|---|---|---|']
for l, s in worst: lines.append(f"| {l} | {s['presence']} | {s['absence']} | {s['order']} | {s['table_adjacency']} | {s['noise_ratio']} | {s['paragraph_retention']} | {s['heading_retention']} | {' '.join(s['noise_sample'][:6])} |")
lines += ['', '## Tier B — real-world files vs reference extractors', '', '| file | fmt | len | degraded | pages (ours/ref) | reference | ned | ref line recall | out line precision | noise | noise sample |', '|---|---|---|---|---|---|---|---|---|---|---|']
for l, s in scores['B'].items():
  if 'error' in s: lines.append(f"| {l} | {s['format']} | ERROR | | | | | | | | {s['error'][:60]} |"); continue
  pg = f"{s.get('pageCount')}/{s.get('ref_pages')}" if 'ref_pages' in s else ''
  if not s['refs']: lines.append(f"| {l} | {s['format']} | {s['length']} | {s['degraded']} | {pg} | (none) | | | | {s.get('noise_ratio', '')} | |")
  for name, rr in s['refs'].items(): lines.append(f"| {l} | {s['format']} | {s['length']} | {s['degraded']} | {pg} | {name} ({rr['ref_length']}) | {rr['ned']} | {rr['ref_line_recall']} | {rr['out_line_precision']} | {s.get('noise_ratio', '')} | {' '.join(s.get('noise_sample', [])[:6])} |")
lines += ['', '## Robustness', '', '| case | expected | passed | outcome |', '|---|---|---|---|']
for n, s in scores['R'].items(): lines.append(f"| {n} | {s['expected']} | {'✅' if s['passed'] else '❌'} | {s['outcome']} |")
open(os.path.join(OUT, 'report.md'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
