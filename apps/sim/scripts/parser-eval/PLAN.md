# Knowledge-base parser quality evaluation

## Why

Every file a connector (Drive, OneDrive, SharePoint, Box, Dropbox, S3, SFTP, Bitbucket, Gmail/Outlook attachments) or an upload delivers as bytes goes through `apps/sim/lib/file-parsers` before chunking and embedding. If a parser emits noise (XML internals, placeholder sentences, boilerplate), drops content, destroys paragraph structure, or scrambles reading order, every downstream search result inherits it silently: the document row still reads "success".

## What the state of the art measures

| Benchmark | What it scores | How |
|---|---|---|
| OmniDocBench (CVPR 2025) | text, tables, formulas, reading order across 10 doc types | Normalized Edit Distance on text and reading order, TEDS on tables; headers/footers/page numbers are an "abandon" class excluded from scoring |
| olmOCR-bench (Ai2) | 1,403 PDFs, 7,010 binary unit tests | text presence, text absence (headers/footers/page numbers must NOT appear), natural reading order pairs, table cell adjacency, math |
| READoc / opendataloader-bench | PDF to structured markdown | heading detection, reading order, table structure, F1 on blocks |

Two design ideas transfer directly: (1) score with **binary unit tests per document** (presence, absence, order, adjacency), because fuzzy whole-document similarity hides localized failures; (2) treat **boilerplate leakage as a first-class failure**, not a rounding error.

## Framework

### Corpus (two tiers)

**Tier A — ground truth by construction.** Source documents are authored as Markdown with a machine-readable spec (paragraphs, headings, list items, table cells, sentinel sentences, ordering pairs). Each source is rendered by pandoc to DOCX, ODT, PPTX, HTML and (via typst) PDF, so the same known content arrives in every container our parsers handle. PDFs are additionally rendered with running headers, footers and page numbers so absence tests are meaningful. Tabular specs are written with SheetJS to XLSX, XLS, XLSB, ODS and CSV.

**Tier B — real-world documents with no gold text.** Public PDFs (two-column papers, forms, reports), DOCX/PPTX/XLSX/DOC/PPT/XLS/ODT files from open-source test corpora, and HTML pages. Scored by agreement against independent reference extractors (PyMuPDF, pdfplumber, python-docx, python-pptx, openpyxl) plus reference-free noise heuristics.

### Metrics per (document, format)

| Metric | Definition | Catches |
|---|---|---|
| `ned` | 1 − Levenshtein(norm(out), norm(gt)) / max(len) | gross content loss or gain |
| `presence` | share of sentinel sentences found (partial ratio ≥ 90) | dropped paragraphs, cells, slide bodies |
| `absence` | share of boilerplate strings (running header/footer/page numbers/"Sheet:" wrappers) NOT found | leakage into the index |
| `order` | share of (a before b) pairs preserved | column/slide/cell reordering |
| `table_adjacency` | share of (left cell, right cell) pairs appearing on one output line | tables exploded one cell per line |
| `noise_ratio` | share of output word tokens absent from gt vocabulary | XML names, placeholders, scraped bytes |
| `paragraph_retention` | output paragraph breaks / gt paragraphs | whitespace collapse that starves the chunker |
| `heading_retention` | share of headings appearing on their own line | headings glued into paragraphs |
| `junk_chars` | control/replacement/private-use chars per 1k chars | encoding damage |
| `chunk_sentence_boundary` | share of TextChunker chunks ending at sentence punctuation | how the parse degrades chunking |
| `metadata` | degraded/truncated/pageCount agree with reality | wrong flags either poison the index or skip good files |
| `latency_ms` | wall time | regressions |

Robustness cases (empty, truncated, mislabeled extension, encrypted, non-UTF8) are scored pass/fail on whether a typed `FileParserError` is raised rather than garbage returned.

### Execution

1. `generate-corpus.py` builds Tier A sources, specs and renders (pandoc + typst + SheetJS).
2. `fetch-real-world.sh` downloads Tier B.
3. `run-parsers.ts` (bun, inside apps/sim so `@/` resolves) runs `parseBuffer` for every file exactly as the ingestion path does (`pdfTextMode: 'complete'` for PDFs) and writes JSON outputs.
4. `reference-extract.py` runs the reference extractors on the same files.
5. `score.py` computes the metric table, aggregated by format and by parser, and lists the worst documents.

Everything reproducible from `apps/sim/scripts/parser-eval/`.
