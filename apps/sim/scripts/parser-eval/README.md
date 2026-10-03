# Knowledge base parser evaluation

Tooling for measuring what `apps/sim/lib/file-parsers` hands to the chunker, and for comparing two checkouts on the same corpus. See `PLAN.md` for the design (modelled on olmOCR-bench unit tests and OmniDocBench scoring), `FINDINGS.md` for the audit that motivated PR #7709, and `BENCHMARK.md` for the before/after results.

## Requirements

- `bun` (run every `.ts` script from `apps/sim` so `@/` and the pinned `xlsx` resolve; set `DATABASE_URL=postgres://x:y@localhost:1/none` because the module graph touches `@sim/db` at import time)
- `pandoc` 3.x and a `typst` executable on `PATH` (the PyPI `typst` package is a library; wrap it in a script named `typst` that runs `typst.compile(input, output=output)`)
- A Python 3.12 environment with `pymupdf pdfplumber python-docx python-pptx openpyxl pandas xlrd pyxlsb odfpy chardet rapidfuzz`; point `PARSER_EVAL_PYTHON` at its interpreter
- `gh` (authenticated) and `curl` for the corpus fetchers; macOS `textutil` for `.doc` references

## Ground-truth corpus (Tier A)

```sh
python generate-corpus.py <corpus-dir> <path-to-typst>
bun scripts/parser-eval/generate-spreadsheets.ts <corpus-dir>
./fetch-real-world.sh <corpus-dir>
DATABASE_URL=postgres://x:y@localhost:1/none bun scripts/parser-eval/run-parsers.ts <corpus-dir>
python reference-extract.py <corpus-dir>
python score.py <corpus-dir>            # writes report.md and scores.json
```

## Large real-world corpus (Tier B)

`bench/manifest.json` pins 961 files by URL and SHA-256. `bench/build.sh` rebuilds the corpus (`fetch` re-downloads only what is missing and `manifest` verifies hashes; sources that drifted are listed in `bench/NOTES.md`), then writes reference extractions and a per-format report.

```sh
PARSER_EVAL_PYTHON=/path/to/python bench/build.sh
DATABASE_URL=postgres://x:y@localhost:1/none bun scripts/parser-eval/bench-run.ts <bench-dir> <bench-dir>/out-<label>
python bench-compare.py <bench-dir> <bench-dir>/out-before <bench-dir>/out-after <bench-dir>/compare.md
```

`bench-compare.py` scores each file against independent extractors and applies the regression gate described at the top of its report: line recall and vocabulary recall may not drop by more than 0.02, noise may not rise by more than 0.02, no new glued tokens, no new degraded output, no unintended ok→error flips, plus `CHECK` flags for count-aware word depletion and for reference words present before and absent after. Every flag must be explained before a change is called an improvement.
