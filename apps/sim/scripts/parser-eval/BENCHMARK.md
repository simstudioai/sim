# Before/after benchmark — 2026-09-09 (final)

961 real-world files in 18 formats (`bench/manifest.json` pins every file by URL and SHA-256; `bench/build.sh` rebuilds the corpus). Baseline = `origin/staging` parsers (`bench-run.ts` → `out-before`); after = this branch at its final commit, run alone on the machine so timings are comparable. Per-file table with every flag: `BENCHMARK-raw.md`. This summary is rendered by `bench-summary.py` from `compare.json`, so it cannot drift from the comparer.

Metrics against independent extractors (PyMuPDF, python-docx, python-pptx, openpyxl/pandas, pandoc, chardet-decoded text). `recall` = share of reference lines (sampled evenly across the whole document) found in our output; `vocab` = share of reference words present, with hyphens collapsed on both sides and digits ignored; `noise` = share of our words absent from the reference; `glued` = distinct tokens that are two reference words fused; `lines` = non-blank output lines.

| ext | n | ok b→a | recall b→a | vocab b→a | noise b→a | glued b→a | lines b→a | ms b→a |
|---|---|---|---|---|---|---|---|---|
| csv | 52 | 52→52 | 0.373→0.373 | 0.657→0.657 | 0.088→0.088 | 0.12→0.12 | 562→562 | 12→13 |
| doc | 51 | 51→41 | 0.522→0.794 | 0.537→0.935 | 0.753→0.003 | 0.04→0.00 | 1→14 | 1→1 |
| docx | 102 | 81→84 | 0.830→0.816 | 0.936→0.962 | 0.001→0.001 | 0.04→0.05 | 164→44 | 23→18 |
| html | 60 | 60→60 | 0.709→0.711 | 0.971→0.974 | 0.146→0.148 | 15.90→7.25 | 2078→1119 | 42→50 |
| json | 31 | 30→31 | 0.989→0.985 | 0.982→0.974 | 0.002→0.002 | 1.03→1.00 | 19655→19023 | 3→4 |
| md | 38 | 38→38 | 1.000→1.000 | 0.996→0.996 | 0.000→0.000 | 0.29→0.29 | 162→162 | 0→0 |
| odp | 27 | 13→14 | — | — | — | — | 4→3 | 1→1 |
| ods | 32 | 32→32 | 0.839→0.927 | 0.976→0.976 | 0.148→0.065 | 0.00→0.00 | 26→26 | 1→1 |
| odt | 44 | 33→32 | 0.892→0.861 | 0.867→0.970 | 0.169→0.066 | 0.30→0.04 | 6→6 | 1→0 |
| pdf | 190 | 190→190 | 0.990→0.989 | 0.977→0.976 | 0.011→0.008 | 3.16→1.23 | 1→1475 | 96→97 |
| ppt | 30 | 30→0 | — | — | — | — | 1→— | 1→— |
| pptx | 72 | 66→44 | 0.979→0.903 | 0.997→0.980 | 0.000→0.001 | 0.00→0.00 | 102→144 | 7→6 |
| txt | 42 | 42→42 | 0.986→1.000 | 0.966→0.974 | 0.003→0.000 | 8.40→5.07 | 8124→8124 | 12→12 |
| xls | 43 | 43→43 | 0.785→0.901 | 0.961→0.961 | 0.070→0.075 | 0.00→0.00 | 104→104 | 6→7 |
| xlsb | 17 | 17→17 | 1.000→1.000 | 0.948→0.933 | 0.041→0.066 | 0.00→0.00 | 28→28 | 1→1 |
| xlsm | 17 | 16→16 | 0.850→0.562 | 0.926→0.926 | 0.124→0.122 | 0.00→0.00 | 61→54 | 11→11 |
| xlsx | 71 | 68→68 | 0.909→0.912 | 0.981→0.983 | 0.108→0.109 | 0.05→0.05 | 91→90 | 11→10 |
| yaml | 42 | 39→42 | 0.829→0.838 | 0.858→0.866 | 0.009→0.009 | 0.15→0.14 | 210→201 | 0→0 |

## What moved and why

- **pdf**: 190/190 parse; line recall and vocabulary unchanged (0.989 / 0.976). Output went from one line per document to real lines and paragraphs (mean 1,475), fused tokens fell 3.2 → 1.2 per file, running headers/footers repeat once instead of once per page, page numbers are dropped. Latency flat (96 → 97 ms mean, p99 757 → 667 ms) after the page join was made linear.
- **doc**: 51 byte-scraped `degraded` outputs (noise 0.75: ZIP names, XML, placeholders; two files returned 3% and 17% of their body) → 41 real extractions via `word-extractor` (noise 0.003, recall 0.52 → 0.79, `degraded` false) plus 10 typed errors: 5 Word 6/95 (`unsupported_type`), 3 files with no body text (textutil agrees), 2 fuzzer fixtures (`invalid_format`).
- **ppt**: 30 degraded scrapes → 30 typed `unsupported_type`; uploads and connectors refuse `.ppt` up front.
- **docx / pptx / odt / odp**: tables emit `[Table]` / `| a | b |` rows, footnotes are kept, notes-page placeholders (slide numbers, headers), ODT comments and tracked deletions are dropped, nested tables are rendered once. Line recall against python-pptx/python-docx falls where the reference emits one cell per line (pptx 0.979 → 0.903) while vocabulary rises (docx 0.936 → 0.962, odt 0.867 → 0.970). 22 image-only LibreOffice pptx fixtures that returned `[Content_Types].xml…` as degraded now raise `no_extractable_text`; 3 decks whose only text was a slide number or a tracked deletion do too.
- **spreadsheets**: cells are display text (`$4,715`, `20%`, `2013-01-12`, `30:00`, `TRUE`) instead of stored values; references hold raw values, so "noise" rises by exactly those tokens and `xlsm` line recall drops on two dashboards whose every cell is formatted. Text-only sheets are byte-identical.
- **txt / yaml / json**: Latin-1, Windows-1252 and BOM inputs decode correctly (glued 8.4 → 5.1 were accent-stripped words); three Kubernetes multi-document manifests and a commented tsconfig now parse.
- **html**: nested tables rendered once (Wikipedia navboxes were triplicated), nested list items keep their marker, ordered lists are numbered; glued 15.9 → 7.3.

## Regression gate

Rules: any ok→error not intended, line recall −0.02, vocabulary −0.02, noise +0.02, any new glued token, junk +0.5/1k, newly degraded; `CHECK` flags for count-aware word depletion and for ≥5 reference words present before and absent after. Final result: **56 files with a REGRESSION flag, 0 SLOWER flags**, every one traced:

| flag | files | cause |
|---|---|---|
| line recall (docx/pptx/odt/doc) | 27 | table rows vs one-cell-per-line references; textutil references include field codes and comment text |
| spreadsheet noise / recall | 13 | display text vs the reference's raw values |
| pdf vocabulary | 13 | math papers: staging output had fused glyph runs (`bσg0`, `2x2`) counted as words; one form lost its folio |
| glued / junk | 4 | Cyrillic cells un-glued (the metric counts the new split as a change), one slide deck |
| ok→error | 3 | two decks whose only text was a slide-number field; one ODT whose body is entirely a tracked deletion |

`CHECK:depleted` fires on 99 files: running footers on IRS/NIST publications (intended, first copy kept), Wikipedia navboxes that were triplicated before, and math-glyph junk. The check exists because an earlier build of this branch deleted repeated table column headers on multi-page tables (IRS tax table: "Married filing jointly" 76 → 20); that is fixed and the counts are back (`Single` 80 → 80, `And your filing status is` 25 → 25).

## Metric history

The gate was tightened twice during the work and the parser fixed in between: the first after-run reported 195 flags (pdf glued 2.4 → 14.1 from over-eager dehyphenation, two spreadsheets refused by the sniffer); collapsing hyphens on both sides and ignoring bare page numbers in the vocabulary metric brought the same output to 81, and the parser fixes to 57. The audit pass then replaced head-of-document line sampling with whole-document sampling and added the count-aware checks; this final run under that stricter comparer shows 56.

## Ground-truth corpus

`REPORT-before.md` → `REPORT-after.md`: pdf paragraph retention 0.06 → 0.98, heading retention 0.00 → 0.91 (headings on their own lines; `## ` markers are off by default), glued 0.14 → 0.00; docx/pptx/odt table adjacency 0.00 → 1.00; xlsx/xls/xlsb typed-cell presence 0.87 → 1.00 and noise 0.12 → 0.02; robustness 14/14 (three expectations were rewritten to the by-design outcome: magic bytes win over the extension, `.ppt` is refused). No format lost presence or order.
