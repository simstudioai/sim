# Findings — 2026-09-09 run

Corpus: 107 ground-truth renders (14 docs × docx/odt/pptx/html/md/pdf, 3 two-column PDFs, 4 workbooks × xlsx/xls/xlsb/ods/csv), 30 real-world files, 14 robustness cases. Raw metrics in `REPORT.md`. Reproduce with the scripts in this directory (see `PLAN.md`).

Content recall is 0.99–1.00 in every prose format and PDF text matches PyMuPDF at NED 0.996–1.000 on six real documents. The problems are structure, boilerplate, and typed cells.

| # | Finding | Where | Evidence |
|---|---|---|---|
| 1 | PDF text flattened to one line before chunking (both modes) | `pdf-parser.ts` `.replace(/\s+/g, ' ')` | paragraph retention 0.06, heading retention 0.00; IRS p17 → 246 chunks, none at a paragraph |
| 2 | Spreadsheet dates/percent/currency indexed raw; Google Sheets sync inherits it | `xlsx-parser.ts` (no `raw:false`/`cellDates`) | `2026-03-04` → `46085`, `20%` → `0.2`; ODS dates → JS local-time string |
| 3 | Running headers/footers/page numbers leak into every PDF | `pdf-parser.ts` | absence 0.00 on 17/17 renders |
| 4 | Tables exploded one cell per line in docx/pptx/odt/odp | mammoth `extractRawText`, officeparser | table adjacency 0.00; mammoth HTML computed but unused |
| 5 | Words glued at line/column/cell boundaries in PDFs | items joined without separator when `hasEOL` false | irs-p17 39 glued tokens, omnidocbench 19, 2 of 3 two-column renders |
| 6 | Legacy .doc/.ppt fallback emits ZIP names, XML, master-slide placeholders | `doc-parser.ts`, `pptx-parser.ts` fallback | 7/7 real files degraded; KB and workspace-files search honour the flag |
| 7 | Slide numbers, footer placeholders, review comments indexed as body | officeparser | `poi-notes.pptx` bare `1..11` + `testdoc`; odt comment spliced mid-sentence |
| 8 | Non-UTF-8 text silently stripped | `txt-parser.ts`/`md-parser.ts` + `sanitizeTextForUTF8` | Latin-1 "Café résumé naïve £" → "Caf rsum nave" |
| 9 | Mislabelled inputs accepted; corrupt PDF error untyped (transient → OCR) | `index.ts` extension routing; pdf.js `Invalid PDF structure.` | CSV-as-xlsx mojibake + serials; HTML-as-txt raw markup |

Fix order: PDF line structure + spacing → PDF furniture suppression → SheetJS formatted text → DOCX via mammoth HTML → officeparser post-processing → transcode fallback for text → type the PDF structure error → magic-byte sniffing.

## Validation pass (9 parallel investigators, 2026-09-09)

All nine findings confirmed. Corrections to the original framing:

| # | Correction | Precedent |
|---|---|---|
| 1 | The whitespace collapse was copied from unpdf 1.4.0 for byte-identical output in #6425; unpdf fixed it in 1.7.0 (PR #58) before #6425 landed. No consumer or test depends on single-line text. pdf.js `hasEOL` arrives on an empty item whose y is the NEXT line. | unpdf #58, pdf.js text_layer, pdfplumber y_tolerance, pdfminer line_margin |
| 2 | `raw:false` alone is not enough: Excel's General format truncates 16-digit numbers to `4.11111E+15` and dates render locale-shaped; a pre-pass rewriting `w` for `t:'d'` and General cells fixes both. The Google Sheets and Microsoft Excel connectors ALREADY request formatted text, so Drive-synced Sheets disagree with Sheets-connector Sheets today. `xlsx-preview-data.ts` (file viewer) has the same defect. | SheetJS `raw`/`cellDates` docs, MarkItDown #53 |
| 3 | 62% of IRS p17 chunks carry the running footer. A frequency rule alone misses footers whose chapter title changes; Marker's consecutive-streak rule (>=3 pages) recovers it. Requires #1 first (needs reconstructed lines + y). | Marker IgnoreTextProcessor, OmniDocBench 'abandon', pymupdf4llm margins |
| 4 | DOCX via mammoth HTML -> existing HtmlParser walker prototyped: 8/8 adjacency, footnotes recovered, zero new deps. mammoth `convertToMarkdown` drops tables (do not use). officeparser 7.8 fixes tables but pulls tesseract.js + pdfjs-dist@6 (126 MB) and drops ODT header rows. | mammoth README, MarkItDown, unstructured, Docling |
| 5 | Fusions are NOT missing-hasEOL at line ends; they are (a) Form XObject boundaries (pdf.js resets prevTransform) and (b) backwards x-move on the same baseline (pdf.js flushes without EOL). Geometry join rule prototyped: catalog 15->0 fusions, IRS 56->25. Dehyphenation must check doc-local compounds or it breaks `open-source`. | pdf.js evaluator constants, MuPDF stext-device, pdfplumber |
| 6 | Worse than reported: two of four real .doc files return 3% and 17% of the body (UCS-2 text invisible to the ASCII regex). KB and workspace search honour `degraded`; Copilot file-reader, chat upload reader, File block (`internal/file/parser.ts`) and `get content` do NOT and hand the scrape to the model. `.xls` is fine (SheetJS BIFF). `word-extractor` (pure JS, frozen 2021) gets 89-100% on the POI .doc files; no viable pure-JS .ppt extractor exists. | word-extractor, Tika, Docling/unstructured shell out to soffice |
| 7 | The leaked `1..11` + `testdoc` come from NOTES PAGES (`ppt/notesSlides`), which officeparser dumps because we pass no options; not slide-level footers. officeparser 7.8 does not fix it. ODT splice includes `text:sender-initials`; tracked-change deletions also leak. Same JSZip walker as #4 fixes both. | python-pptx placeholder types, MarkItDown, POI SlideShowExtractor, pandoc ODT reader |
| 8 | Also: UTF-8 BOM leaks into content; UTF-16 'pass' was an ASCII accident; connectors keep U+FFFD as mojibake. Bun 1.3.14 TextDecoder supports `fatal` + `windows-1252` natively. Truncated-UTF-8 downloads need a tail retry before falling back. | Tika EncodingDetector chain, unstructured encoding.py, LangChain autodetect_encoding |
| 9 | `Invalid PDF structure.` is a named `InvalidPDFException`; the classifier just never checks it. docx-as-pdf never reaches OCR (`assertOcrSourceSupported` sniffs `%PDF-`). Truncated PDFs with a header DO reach OCR, deliberately, pinned by `pdf-ocr-triage.test.ts:439,580`. `ArchiveIntegrityError` is already classified permanent. `file-type@16.5.4` (CJS) is already in the tree via officeparser. | Tika detection precedence, unstructured detect_filetype, pdf.js exception names |
