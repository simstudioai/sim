"""Reference extractions for Tier B files using independent libraries. Usage: reference-extract.py <corpus-dir>"""
import json, os, sys, warnings
warnings.filterwarnings('ignore')
OUT = sys.argv[1]; REAL = os.path.join(OUT, 'real'); REF = os.path.join(OUT, 'reference'); os.makedirs(REF, exist_ok=True)
import pymupdf, pdfplumber, docx, pptx, openpyxl

def pdf_refs(p):
  d = pymupdf.open(p)
  mu = '\n'.join(page.get_text() for page in d)
  out = {'pymupdf': mu, 'pages': d.page_count}
  try:
    with pdfplumber.open(p) as pl:
      out['pdfplumber'] = '\n'.join((pg.extract_text() or '') for pg in pl.pages[:60])
  except Exception as e: out['pdfplumber_error'] = str(e)
  return out
def docx_ref(p):
  d = docx.Document(p); parts = [para.text for para in d.paragraphs]
  for t in d.tables:
    for r in t.rows: parts.append('\t'.join(c.text for c in r.cells))
  for s in d.sections:
    for hf in (s.header, s.footer):
      for para in hf.paragraphs:
        if para.text.strip(): parts.append('[HF] ' + para.text)
  return {'python-docx': '\n'.join(parts)}
def pptx_ref(p):
  prs = pptx.Presentation(p); parts = []
  for i, s in enumerate(prs.slides):
    for sh in s.shapes:
      if sh.has_text_frame: parts.append(sh.text_frame.text)
      if getattr(sh, 'has_table', False) and sh.has_table:
        for r in sh.table.rows: parts.append('\t'.join(c.text for c in r.cells))
    if s.has_notes_slide and s.notes_slide.notes_text_frame: parts.append('[NOTES] ' + s.notes_slide.notes_text_frame.text)
  return {'python-pptx': '\n'.join(parts), 'slides': len(prs.slides)}
def xlsx_ref(p):
  wb = openpyxl.load_workbook(p, data_only=True, read_only=True); parts = []
  for ws in wb.worksheets:
    parts.append(f'[SHEET {ws.title}]')
    for row in ws.iter_rows(values_only=True):
      if any(v is not None for v in row): parts.append('\t'.join('' if v is None else str(v) for v in row))
  return {'openpyxl': '\n'.join(parts), 'sheets': wb.sheetnames}

for f in sorted(os.listdir(REAL)):
  ext = f.rsplit('.', 1)[-1].lower(); p = os.path.join(REAL, f)
  try:
    if ext == 'pdf': ref = pdf_refs(p)
    elif ext == 'docx': ref = docx_ref(p)
    elif ext == 'pptx': ref = pptx_ref(p)
    elif ext == 'xlsx': ref = xlsx_ref(p)
    else: continue
  except Exception as e: ref = {'error': str(e)}
  json.dump(ref, open(os.path.join(REF, f + '.json'), 'w'), ensure_ascii=False)
  print(f, {k: (len(v) if isinstance(v, str) else v) for k, v in ref.items()})
