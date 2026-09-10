# KB parser benchmark corpus — build notes

Built 2026-09-09 with `./build.sh` (stages: `fetch`, `manifest`, `reference`, `report`). Layout:
`files/<ext>/<source>__<name>.<ext>`, `manifest.json` (file, ext, source_url, size, sha256), `reference/<name>.<ext>.json`.
Reference extractions come from `reference.py` (pymupdf, python-docx + pandoc, textutil, python-pptx, openpyxl, pandas[xlrd|pyxlsb|odf], pandoc, chardet).
Files >25 MB, zero-byte, sha256 duplicates (none found) and encrypted fixtures are dropped (`postprocess.sh`, `manifest.py`).

## Achieved counts (target in parentheses)

| ext  | files | target | notes |
|------|------:|-------:|-------|
| pdf  | 190 | 120 | 96 arXiv (8 categories), 27 IRS, 17 NIST, 7 Fed, 13 slide decks, 18 pdf.js, 11 pdfplumber, 1 unstructured |
| docx | 102 | 100 | poi 40, LibreOffice ooxmlexport/import 30, mammoth 17, python-docx 4, unstructured 12 |
| doc  | 51 | 50 | poi, LibreOffice ww8export/import, unstructured |
| pptx | 72 | 70 | poi, LibreOffice, python-pptx, unstructured |
| ppt  | 30 | 30 | poi, LibreOffice |
| xlsx | 71 | 70 | poi, LibreOffice, unstructured |
| xls  | 43 | 40 | poi, LibreOffice, unstructured |
| xlsb | 17 | 10 | poi, LibreOffice |
| xlsm | 17 | 10 | poi, LibreOffice |
| ods  | 32 | 30 | LibreOffice |
| odt  | 44 | 40 | LibreOffice odfexport/odfimport, unstructured |
| odp  | 27 | 25 | LibreOffice (no reference extractor; pandoc does not read odp) |
| html | 60 | 60 | 25 Wikipedia, 10 MDN, 10 docs, 10 gov/news, 5 W3C |
| csv  | 52 | 40 | 34 datasets org, 8 LibreOffice sc/qa csv (semicolon / locale separators), quoted fixtures from csv-parser + pandas + seaborn |
| json | 31 | 30 | package.json, tsconfig, OpenAPI examples (learn.openapis.org), GitHub GHEC OpenAPI (22 MB), Stripe spec3, SchemaStore |
| yaml | 42 | 30 | GitHub Actions workflows, docker/awesome-compose, k8s website examples, OpenAPI yaml |
| md   | 38 | 40 | READMEs of well-known repos (repos with README.rst were swapped out) |
| txt  | 42 | 30 | LICENSE/COPYING/CHANGES, RFCs, 15 Gutenberg books + 5 re-encoded variants |

## Sources that failed or were substituted

- **SheetJS/test_files**: `gh api` returns HTTP 403 "Repository access blocked" (DMCA-style block). Replaced by LibreOffice `sc/qa/unit/data/{xls,xlsx,xlsb,xlsm}`.
- **GAO** (`gao.gov/assets/*.pdf`) and **CBO** (`cbo.gov/system/files/*`): HTTP 403 to curl. Replaced by NIST SP/FIPS/AI/CSWP and Federal Reserve (Beige Book, FOMC minutes, FSR, annual report, DFAST, FEDS/IFDP papers).
- **Federal Reserve**: several guessed URLs 404 (monetary policy report, SCB); 7 verified URLs kept.
- **Project Gutenberg Latin-1 `-8.txt` variants**: 404 on gutenberg.org and the pglaf mirror (Gutenberg dropped them). `postprocess.sh` re-encodes three UTF-8 books to ISO-8859-1, one to windows-1252, and one with a UTF-8 BOM (`gutenberg_latin1__*`, `gutenberg_cp1252__*`, `gutenberg_bom__*`; source_url = `local-reencode`).
- **arXiv**: newest submissions (sortBy=submittedDate, start=0) had no PDF yet (404); the query uses `start=300`. The first run's PDFs were kept, so the arXiv share is ~96 instead of 50. Downloads were sequential at 1 req/s.
- **Slide decks**: GitHub code search for `filename:slides.pdf` only returns text-indexed hits, i.e. Git LFS pointers / git-annex symlinks / HTML. Pointers are resolved via `media.githubusercontent.com/media/...`; symlinks (RichiH, ULHPC), one HTML page (bit4woo) and one 404 LFS blob (rohan-sawhney) were dropped by the `%PDF` magic check. Three `alopresto/slides/*/slides.pdf` collide on the sanitized name; only one survives.
- **IRS p535.pdf**: retired; irs.gov serves an HTML page. Dropped by the `%PDF` check.
- **maxogden/csv-spectrum**: raw URLs 404 for both `HEAD` and `master` although the contents API lists the files. Skipped.
- **OAI/OpenAPI-Specification examples**: moved to `OAI/learn.openapis.org`; updated.
- Minor 404s left as-is: `vitejs/vite tsconfig.json`, `ImageMagick ChangeLog`.
- Nine apache/poi xlsx downloads timed out on the first pass (raw.githubusercontent.com); the retry pass fetched them.

## Reference-extraction caveats

- `ppt` and `odp` have no reference (`{"error":"no reference"}`).
- Encrypted fixtures removed: `poi__PasswordProtected.doc`, `poi__bug53475-password-is-solrcell.docx`, `pdfplumber__password-example.pdf`, `poi__Password_Protected-hello.ppt`, `poi__protected_passtika.xlsb`, `unstr__password_protected.xlsx`. Sheet/workbook-protection (not encryption) fixtures are kept.
- Deliberately corrupt fuzzer fixtures from apache/poi (`clusterfuzz-*`, `crash-*`) are kept — their reference JSON carries `error` / `*_error` fields (6 docx, 4 pptx, 3 xlsx, 1 xls, 1 xlsb, 1 ods). They are useful for "parser must not hang or crash" checks, not for text comparison.
- Spreadsheet references: openpyxl `data_only=True` for xlsx/xlsm; pandas for xls (xlrd), xlsb (pyxlsb), ods (odfpy). Dates are ISO (`YYYY-MM-DD`, full ISO when a time component exists); integral floats print without `.0`.
- pdfplumber was not run (slow); only pymupdf page text + page count.
- `pandoc -t plain --wrap=none` for docx/odt/html.
