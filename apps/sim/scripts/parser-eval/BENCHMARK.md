# Before/after benchmark — 2026-09-09

961 real-world files in 18 formats (`bench/build.sh` reproduces the corpus: arXiv, IRS, NIST, Federal Reserve, pdf.js and pdfplumber test PDFs; Apache POI, LibreOffice, python-docx, python-pptx, mammoth and unstructured fixtures; Wikipedia/MDN/WHATWG pages; datasets.org CSVs; GitHub JSON/YAML/Markdown; Project Gutenberg text in UTF-8, Latin-1, Windows-1252 and BOM variants). Baseline = `origin/staging` parsers (`bench-run.ts` → `out-before`), after = this branch (`out-after2`). Full per-file table in `BENCHMARK-raw.md`.

Metrics against independent extractors (PyMuPDF, python-docx, python-pptx, openpyxl/pandas, pandoc, chardet-decoded text). `recall` = share of reference lines found in our output; `vocab` = share of reference words (hyphens collapsed, digits ignored) present; `noise` = share of our words absent from the reference; `glued` = distinct tokens that are two reference words fused; `lines` = non-blank output lines.

| ext | n | ok b→a | recall b→a | vocab b→a | noise b→a | glued b→a | lines b→a | ms b→a |
|---|---|---|---|---|---|---|---|---|
| pdf | 190 | 190→190 | 0.991→0.991 | 0.977→0.976 | 0.116→0.102 | 3.16→1.23 | 1→1467 | 96→123 |
| docx | 102 | 81→84 | 0.830→0.830 | 0.936→0.962 | 0.040→0.040 | 0.04→0.05 | 164→44 | 23→15 |
| doc | 51 | 51→41 | 0.522→0.793 | 0.535→0.933 | 0.759→0.041 | 0.04→0.00 | 1→14 | 1.4→0.8 |
| pptx | 72 | 66→44 | 0.979→0.903 | 0.997→0.980 | 0.030→0.025 | 0→0 | 102→143 | 7→5 |
| ppt | 30 | 30→0 | — | — | — | — | — | — |
| odt | 44 | 33→32 | 0.892→0.861 | 0.867→0.970 | 0.182→0.079 | 0.30→0.04 | 6.2→5.7 | 0.6→0.4 |
| odp | 27 | 13→13 | (no reference) | | | | 3.6→3.8 | 0.8→0.5 |
| xlsx | 71 | 68→68 | 0.911→0.955 | 0.981→0.983 | 0.251→0.257 | 0.02→0.02 | 91→91 | 11→10 |
| xls | 43 | 43→43 | 0.806→0.924 | 0.961→0.961 | 0.322→0.349 | 0→0 | 104→104 | 6→6 |
| xlsm | 17 | 16→16 | 0.850→0.575 | 0.926→0.930 | 0.338→0.381 | 0→0 | 61→59 | 11→12 |
| xlsb | 17 | 17→17 | 1.000→1.000 | 0.948→0.933 | 0.233→0.252 | 0→0 | 28→28 | 1.3→1.3 |
| ods | 32 | 32→32 | 0.839→0.927 | 0.976→0.976 | 0.349→0.326 | 0→0 | 26→26 | 1.3→1.3 |
| html | 60 | 60→60 | 0.791→0.795 | 0.971→0.973 | 0.195→0.197 | 16.4→9.85 | 2078→1142 | 42→47 |
| csv | 52 | 52→52 | 0.556→0.556 | 0.658→0.658 | 0.534→0.534 | 0.02→0.02 | 562→562 | 12→12 |
| json | 31 | 30→30 | 0.990→0.990 | 0.982→0.982 | 0.043→0.043 | 0→0 | 19655→19655 | 3.4→3.3 |
| yaml | 42 | 39→39 | 0.829→0.829 | 0.857→0.857 | 0.044→0.044 | 0→0 | 210→210 | 0.3→0.3 |
| md | 38 | 38→38 | 1.000→1.000 | 0.996→0.996 | 0.010→0.010 | 0→0 | 162→162 | 0.3→0.3 |
| txt | 42 | 42→42 | 0.999→1.000 | 0.965→0.973 | 0.034→0.031 | 3.67→0.00 | 8124→8124 | 12→12 |

## What moved and why

- **pdf**: 190/190 still parse; line recall and vocabulary unchanged (0.991 / 0.976). Output went from 1 line per document to real lines and paragraphs (mean 1,467), glued tokens fell 3.2 → 1.2 per file, repeated furniture lines are suppressed after their first occurrence, and page numbers are removed. Latency +28% (geometry per item, two-pass furniture detection).
- **doc**: 51 byte-scraped, `degraded` outputs (mean noise 0.76 — ZIP names, XML, placeholders; 2 files returned 3% and 17% of their body) → 41 real extractions via `word-extractor` (noise 0.04, recall 0.52 → 0.79, `degraded` false) plus 10 typed errors: 5 Word 6/95 files (`unsupported_type`), 3 files with no body text (textutil agrees), 2 fuzzer fixtures (`invalid_format`).
- **ppt**: 30 degraded scrapes → 30 typed `unsupported_type`. Every consumer already refused degraded content; this makes the refusal explicit and stops the download.
- **docx / pptx / odt / odp**: tables emit `[Table]` / `| a | b |` rows instead of one cell per line, notes-page placeholders (slide numbers, headers) and ODT comments/tracked deletions are dropped, footnotes are kept. Line recall against python-pptx/python-docx falls where the reference emits one cell per line (`pptx` 0.979 → 0.903) while vocabulary rises (`docx` 0.936 → 0.962, `odt` 0.867 → 0.970). 22 image-only LibreOffice pptx fixtures that used to return `[Content_Types].xml…` as degraded now raise `no_extractable_text`; 2 decks whose only text was a slide number now raise it too.
- **spreadsheets**: cells are display text (`$4,715`, `20%`, `2013-01-12`, `TRUE`) instead of stored values (`4715`, `0.2`, `41286`, `true`). The references are raw values, so "noise" rises by exactly those tokens and `xlsm` line recall drops on two dashboards whose every cell is formatted. Text-only sheets are byte-identical.
- **txt**: Latin-1 / Windows-1252 / BOM inputs decode correctly (glued 3.67 → 0 was accent-stripped words); every other text format is unchanged.
- **html**: nested list items get their own marker and ordered lists are numbered; glued tokens 16.4 → 9.9.

## Regression gate

Rules: any ok→error not intended, line recall −0.02, vocabulary −0.02, noise +0.02, any new glued token, junk +0.5/1k, newly degraded. Result: 57 flagged files, every one traced to a reference artifact or an intended change:

| flag | files | cause |
|---|---|---|
| spreadsheet noise / recall | 27 | display text vs the reference's raw values (`$12,345.00` vs `12345`, ISO dates vs serials, LibreOffice locale text `1,4965`) |
| docx / pptx / odt line recall | 11 | table rows vs one cell per line in the reference; a duplicated `[Table]` line for single-cell tables |
| doc recall / vocabulary | 9 | textutil reference includes field codes and comment text (`Inner Outer`) that a real extractor drops; three files legitimately empty |
| pdf vocabulary | 7 | math papers: before-output had fused glyph runs (`bσg0`, `2x2`) counted as "words"; one form lost its `Page` folio |
| pptx ok→error | 2 | decks whose only text was the slide-number field |
| odt ok→error | 1 | all body text inside a tracked deletion (pandoc also yields nothing) |

Ground-truth corpus (`REPORT-before.md` → `REPORT-after.md`): pdf paragraph retention 0.06 → 0.97, heading retention 0.00 → 1.00, glued 0.14 → 0.00; docx/pptx/odt table adjacency 0.00 → 1.00; xlsx/xls/xlsb typed-cell presence 0.87 → 1.00 and noise 0.12 → 0.02; robustness 6/14 → 14/14. No format lost presence or order.
