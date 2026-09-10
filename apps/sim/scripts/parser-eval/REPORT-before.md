# Parser quality report

Tier A: 107 files, Tier B: 30 files, robustness: 14 cases

## Tier A — ground truth by construction (mean per format)

| format | n | ned | presence | absence | order | table_adjacency | noise_ratio | glued_words | paragraph_retention | heading_retention | chunk_sentence_boundary | junk_per_1k | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| csv | 4 | 0.70 | 0.98 | — | — | 0.95 | 0.00 | 0.00 | — | — | — | 0.00 | 1.65 |
| docx | 14 | 0.96 | 1.00 | — | 1.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.91 | 1.00 | 0.00 | 11.35 |
| html | 14 | 0.91 | 1.00 | — | 1.00 | 1.00 | 0.01 | 0.00 | 1.00 | 0.85 | 1.00 | 0.00 | 1.69 |
| md | 14 | 0.94 | 1.00 | — | 1.00 | 1.00 | 0.00 | 0.00 | 0.99 | 1.00 | 1.00 | 0.00 | 0.13 |
| ods | 4 | 0.78 | 0.87 | — | — | 0.81 | 0.14 | 0.00 | — | — | — | 0.00 | 2.17 |
| odt | 14 | 0.96 | 1.00 | — | 1.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.91 | 1.00 | 0.00 | 2.81 |
| pdf | 14 | 0.89 | 0.99 | 0.00 | 1.00 | 0.87 | 0.07 | 0.14 | 0.06 | 0.00 | 0.00 | 0.00 | 16.11 |
| pdf-2col | 3 | 0.93 | 1.00 | 0.00 | 1.00 | 0.72 | 0.05 | 0.67 | 0.03 | 0.00 | 0.00 | 0.00 | 8.43 |
| pptx | 14 | 0.96 | 1.00 | — | 1.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.91 | 1.00 | 0.00 | 2.26 |
| xls | 4 | 0.81 | 0.87 | — | — | 0.81 | 0.12 | 0.00 | — | — | — | 0.00 | 2.25 |
| xlsb | 4 | 0.81 | 0.87 | — | — | 0.81 | 0.12 | 0.00 | — | — | — | 0.00 | 1.60 |
| xlsx | 4 | 0.81 | 0.87 | — | — | 0.81 | 0.12 | 0.00 | — | — | — | 0.00 | 3.27 |

### Worst Tier A files by sentinel presence / adjacency / noise

| file | presence | absence | order | adjacency | noise | para | heading | noise sample |
|---|---|---|---|---|---|---|---|---|
| sheet-typed.ods | 0.464 | None | None | 0.25 | 0.515 | None | None | 0700 0800 085 1063 12000 1250 |
| sheet-typed.xls | 0.464 | None | None | 0.25 | 0.455 | None | None | 085 1063 12000 1250 1500 46085 |
| sheet-typed.xlsb | 0.464 | None | None | 0.25 | 0.455 | None | None | 085 1063 12000 1250 1500 46085 |
| sheet-typed.xlsx | 0.464 | None | None | 0.25 | 0.455 | None | None | 085 1063 12000 1250 1500 46085 |
| unicode-multilingual.pdf | 0.833 | 0.0 | 1.0 | 1.0 | 0.185 | 0.083 | None | acme confidential corp distribute do draft |
| sheet-typed.csv | 0.929 | None | None | 0.792 | 0.0 | None | None |  |
| changelog.pdf | None | 0.0 | None | None | 0.121 | 0.062 | 0.0 | acme confidential corp distribute do draft |
| product-catalog.2col.pdf | 1.0 | 0.0 | 1.0 | 0.686 | 0.094 | 0.021 | None | 2027hw acme confidential corp discounthw distribute |
| product-catalog.pdf | 1.0 | 0.0 | 1.0 | 0.686 | 0.094 | 0.021 | None | 2027hw acme confidential corp discounthw distribute |
| memo.pdf | 1.0 | 0.0 | 1.0 | None | 0.091 | 0.143 | None | acme confidential corp distribute do draft |
| onboarding-guide.pdf | 1.0 | 0.0 | 1.0 | None | 0.081 | 0.062 | 0.0 | acme confidential corp distribute do draft |
| sop-access-review.pdf | 1.0 | 0.0 | 1.0 | 0.75 | 0.077 | 0.05 | 0.0 | acme confidential corp distribute do draft |
| meeting-notes.pdf | 1.0 | 0.0 | 1.0 | 0.875 | 0.068 | 0.062 | 0.0 | acme confidential corp distribute do internal |
| tech-spec.pdf | 1.0 | 0.0 | 1.0 | 1.0 | 0.062 | 0.038 | 0.0 | acme confidential corp distribute do draft |
| faq-benefits.pdf | 1.0 | 0.0 | 1.0 | None | 0.061 | 0.091 | 0.0 | acme confidential corp distribute draft infra |

## Tier B — real-world files vs reference extractors

| file | fmt | len | degraded | pages (ours/ref) | reference | ned | ref line recall | out line precision | noise | noise sample |
|---|---|---|---|---|---|---|---|---|---|---|
| attention.pdf | pdf | 39642 | False | 15/15 | pymupdf (39495) | 0.996 | 1.0 | 1.0 | 0.001 | df epos visualizationsinput |
| attention.pdf | pdf | 39642 | False | 15/15 | pdfplumber (35525) | 0.849 | 0.185 | 1.0 | 0.001 | df epos visualizationsinput |
| bitcoin.pdf | pdf | 21227 | False | 9/9 | pymupdf (21220) | 0.999 | 1.0 | 1.0 | 0.0 | blockblock |
| bitcoin.pdf | pdf | 21227 | False | 9/9 | pdfplumber (21216) | 0.906 | 0.915 | 1.0 | 0.0 | blockblock |
| irs-f1040.pdf | pdf | 10151 | False | 2/2 | pymupdf (10156) | 1.0 | 1.0 | 1.0 | 0.001 | 2025u |
| irs-f1040.pdf | pdf | 10151 | False | 2/2 | pdfplumber (10152) | 0.8 | 0.739 | 0.0 | 0.001 | 2025u |
| irs-p17.pdf | pdf | 959987 | False | 142/142 | pymupdf (960116) | 1.0 | 1.0 | 1.0 | 0.0 | 000caution 16caution 2025get 4vtip 8815records andcaution |
| irs-p17.pdf | pdf | 959987 | False | 142/142 | pdfplumber (431054) | 0.295 | 0.215 | 0.0 | 0.0 | 000caution 16caution 2025get 4vtip 8815records andcaution |
| lo-fdo38244.odt | odt | 32 | False |  | pandoc (16) | 0.5 | None | None | 0.2 | mfirst |
| lo-lists.odt | odt | ERROR | | | | | | | | No text could be extracted from this OpenDocument file |
| lo-simple.odp | odp | 28 | False |  | (none) | | | |  | |
| lo-simple.ods | ods | 12322 | False |  | (none) | | | |  | |
| lo-tables.odt | odt | 17 | False |  | (none) | | | |  | |
| mdn-fetch.html | html | 6810 | False |  | (none) | | | |  | |
| omnidocbench.pdf | pdf | 103150 | False | 32/32 | pymupdf (102111) | 0.999 | 1.0 | 1.0 | 0.005 | 10190 2011年1月1日 7000 aaaaa ajhb annotationsfigure |
| omnidocbench.pdf | pdf | 103150 | False | 32/32 | pdfplumber (100495) | 0.354 | 0.365 | 1.0 | 0.005 | 10190 2011年1月1日 7000 aaaaa ajhb annotationsfigure |
| pdf-reference-excerpt.pdf | pdf | 14 | False | 1/1 | pymupdf (14) | 1.0 | None | None | 0.0 |  |
| pdf-reference-excerpt.pdf | pdf | 14 | False | 1/1 | pdfplumber (14) | 1.0 | None | None | 0.0 |  |
| poi-basic.ppt | ppt | 907 | True |  | (none) | | | |  | |
| poi-bug-tables.doc | doc | 416 | True |  | (none) | | | |  | |
| poi-bullets.ppt | ppt | 767 | True |  | (none) | | | |  | |
| poi-footnotes.docx | docx | 35 | False |  | python-docx (33) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| poi-footnotes.docx | docx | 35 | False |  | pandoc (47) | 0.702 | 1.0 | 1.0 | 0.0 |  |
| poi-header-footer.doc | doc | 660 | True |  | (none) | | | |  | |
| poi-headerfooter.docx | docx | ERROR | | | | | | | | No text could be extracted from this DOCX file |
| poi-layouts.pptx | pptx | 645 | False |  | python-pptx (650) | 0.983 | 1.0 | 1.0 | 0.0 |  |
| poi-lists.doc | doc | 1198 | True |  | (none) | | | |  | |
| poi-multisheet.xls | xls | 133 | False |  | (none) | | | |  | |
| poi-notes.pptx | pptx | 2393 | False |  | python-pptx (2357) | 0.968 | 1.0 | 1.0 | 0.037 | 10 testdoc |
| poi-sample.docx | docx | 1548 | False |  | python-docx (1542) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.docx | docx | 1548 | False |  | pandoc (1542) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.pptx | pptx | 140 | False |  | python-pptx (152) | 0.908 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.xlsx | xlsx | 391 | False |  | openpyxl (292) | 0.753 | 1.0 | 0.5 | 0.019 | empty |
| poi-sampledoc.doc | doc | 1463 | True |  | (none) | | | |  | |
| poi-simple.xls | xls | 144 | False |  | (none) | | | |  | |
| poi-tables.ppt | ppt | 6359 | True |  | (none) | | | |  | |
| w3c-html-spec-intro.html | html | 54667 | False |  | (none) | | | |  | |
| wiki-rag.html | html | 28081 | False |  | (none) | | | |  | |

## Robustness

| case | expected | passed | outcome |
|---|---|---|---|
| csv-labelled-xlsx | typed error OR correct UTF-8 text | ❌ | ok 3122 chars |
| docx-bytes-labelled-pdf | typed error | ❌ | UNTYPED: Invalid PDF structure. |
| docx-labelled-doc | correct text | ✅ | ok 843 chars |
| docx-labelled-xlsx | typed error | ✅ | typed invalid_format: Failed to parse XLSX buffer: Could not find workbook |
| empty.docx | typed error | ✅ | typed empty_input: Empty buffer provided |
| html-labelled-txt | markup stripped or typed error | ❌ | ok 4904 chars |
| latin1-txt | text decodes to "Café résumé naïve £" | ❌ | ok 17 chars |
| pdf-bytes-labelled-docx | typed error OR correct text | ✅ | ok 933 chars |
| png-labelled-doc | typed error, never placeholder prose | ❌ | ok 87 chars DEGRADED |
| pptx-labelled-ppt | correct text | ✅ | ok 843 chars |
| random-bytes-labelled-ppt | typed error, never placeholder prose | ❌ | ok 99 chars DEGRADED |
| truncated-docx | typed error (invalid_format) | ❌ | UNTYPED: Unable to inspect ZIP central directory; refusing to parse an unverifiable ZIP-shaped arch |
| truncated-pdf | typed error (invalid_format) | ❌ | UNTYPED: Invalid PDF structure. |
| utf16-txt | text decodes to "Hello UTF-16 world" | ✅ | ok 18 chars |
