import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'

const EXTRACT_TIMEOUT_MS = 120_000
// Bound the text handed back to the agent so a huge document can't blow the
// context window; the agent gets a clear truncation marker if it hits the cap.
const MAX_EXTRACT_CHARS = 200_000

/** Binary document formats whose text/tables we can extract in the doc sandbox. */
const EXTRACTABLE_EXTS = new Set(['pdf', 'pptx', 'docx', 'xlsx'])

export function isExtractableDocExt(ext: string): boolean {
  return EXTRACTABLE_EXTS.has(ext.toLowerCase())
}

export interface DocExtract {
  text: string
  truncated: boolean
}

/**
 * Extracts readable text (and tables) from an uploaded binary document inside the
 * E2B doc sandbox so the agent can read/reason over files it cannot otherwise see
 * as source: pdf via pdfplumber, pptx via python-pptx, docx via python-docx, xlsx
 * via openpyxl. Read-only — never mutates the file. Throws on sandbox/infra
 * failure or an unparseable document.
 */
export async function extractDocText(args: { binary: Buffer; ext: string }): Promise<DocExtract> {
  const ext = args.ext.toLowerCase()
  if (!isExtractableDocExt(ext)) {
    throw new Error(`Cannot extract text from .${ext} (supported: pdf, pptx, docx, xlsx)`)
  }

  const script = `
import json
ext = ${JSON.stringify(ext)}
inp = f"/home/user/input.{ext}"
out = []

if ext == "pdf":
    import pdfplumber
    with pdfplumber.open(inp) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            out.append(f"--- Page {i} ---")
            out.append(page.extract_text() or "")
            for t in (page.extract_tables() or []):
                out.append("[table] " + json.dumps(t, ensure_ascii=False))
elif ext == "pptx":
    from pptx import Presentation
    prs = Presentation(inp)
    for i, slide in enumerate(prs.slides, 1):
        out.append(f"--- Slide {i} ---")
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                out.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    out.append(" | ".join(c.text for c in row.cells))
        nf = slide.notes_slide.notes_text_frame if slide.has_notes_slide else None
        notes = nf.text if nf is not None else ""
        if notes.strip():
            out.append("[notes] " + notes)
elif ext == "docx":
    import docx
    d = docx.Document(inp)
    for p in d.paragraphs:
        if p.text.strip():
            out.append(p.text)
    for tbl in d.tables:
        for row in tbl.rows:
            out.append(" | ".join(c.text for c in row.cells))
elif ext == "xlsx":
    import openpyxl
    wb = openpyxl.load_workbook(inp, data_only=True)
    for ws in wb.worksheets:
        out.append(f"--- Sheet {ws.title} ---")
        # Cap rows so an inflated used-range can't blow up memory/output.
        for ri, row in enumerate(ws.iter_rows(values_only=True)):
            if ri >= 5000:
                out.append("[... more rows truncated]")
                break
            out.append(",".join("" if v is None else str(v) for v in row))

# Bound the transferred text so a decompression bomb can't return gigabytes.
# Headroom over MAX_EXTRACT_CHARS so the TS-side truncation flag can still fire.
text = "\\n".join(out)[:${MAX_EXTRACT_CHARS + 20000}]
print("__SIM_RESULT__=" + json.dumps({"text": text}))
`.trim()

  const result = await executeInSandbox({
    code: script,
    language: CodeLanguage.Python,
    timeoutMs: EXTRACT_TIMEOUT_MS,
    sandboxKind: 'doc',
    sandboxFiles: [
      {
        path: `/home/user/input.${ext}`,
        content: args.binary.toString('base64'),
        encoding: 'base64',
      },
    ],
  })

  if (result.error) {
    throw new Error(`Document extraction failed: ${result.error}`)
  }
  const payload = result.result as { text?: string } | null
  const full = payload?.text ?? ''
  const truncated = full.length > MAX_EXTRACT_CHARS
  // The caller (VFS read) owns the user-facing truncation note; just return the
  // bounded text + the flag here.
  return { text: full.slice(0, MAX_EXTRACT_CHARS), truncated }
}
