# Parser quality report

Tier A: 107 files, Tier B: 30 files, robustness: 14 cases

## Tier A — ground truth by construction (mean per format)

| format | n | ned | presence | absence | order | table_adjacency | noise_ratio | glued_words | paragraph_retention | heading_retention | chunk_sentence_boundary | junk_per_1k | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| csv | 4 | 0.70 | 1.00 | — | — | 0.99 | 0.00 | 0.00 | — | — | — | 0.00 | 1.75 |
| docx | 14 | 0.94 | 1.00 | — | 1.00 | 1.00 | 0.01 | 0.00 | 0.98 | 0.91 | 1.00 | 0.00 | 9.36 |
| html | 14 | 0.91 | 1.00 | — | 1.00 | 1.00 | 0.01 | 0.00 | 1.00 | 0.85 | 1.00 | 0.00 | 1.20 |
| md | 14 | 0.94 | 1.00 | — | 1.00 | 1.00 | 0.00 | 0.00 | 0.99 | 1.00 | 1.00 | 0.00 | 0.12 |
| ods | 4 | 0.86 | 0.92 | — | — | 0.88 | 0.06 | 0.00 | — | — | — | 0.00 | 2.10 |
| odt | 14 | 0.94 | 1.00 | — | 1.00 | 1.00 | 0.01 | 0.00 | 0.99 | 0.91 | 1.00 | 0.00 | 1.26 |
| pdf | 14 | 0.90 | 0.99 | 0.00 | 1.00 | 0.94 | 0.07 | 0.00 | 0.98 | 0.91 | 1.00 | 0.00 | 15.26 |
| pdf-2col | 3 | 0.94 | 1.00 | 0.00 | 1.00 | 0.93 | 0.03 | 0.00 | 0.89 | 0.50 | 1.00 | 0.00 | 8.10 |
| pptx | 14 | 0.93 | 1.00 | — | 1.00 | 1.00 | 0.01 | 0.00 | 0.99 | 0.91 | 0.00 | 0.00 | 1.98 |
| xls | 4 | 0.90 | 1.00 | — | — | 0.99 | 0.02 | 0.00 | — | — | — | 0.00 | 2.27 |
| xlsb | 4 | 0.90 | 1.00 | — | — | 0.99 | 0.02 | 0.00 | — | — | — | 0.00 | 1.55 |
| xlsx | 4 | 0.90 | 1.00 | — | — | 0.99 | 0.02 | 0.00 | — | — | — | 0.00 | 3.40 |

### Worst Tier A files by sentinel presence / adjacency / noise

| file | presence | absence | order | adjacency | noise | para | heading | noise sample |
|---|---|---|---|---|---|---|---|---|
| sheet-typed.ods | 0.679 | None | None | 0.5 | 0.2 | None | None | 085 1063 12000 1250 1500 8425 |
| unicode-multilingual.pdf | 0.833 | 0.0 | 1.0 | 1.0 | 0.185 | 1.0 | None | acme confidential corp distribute do draft |
| changelog.pdf | None | 0.0 | None | None | 0.121 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| memo.pdf | 1.0 | 0.0 | 1.0 | None | 0.077 | 1.0 | None | acme confidential corp distribute do draft |
| sop-access-review.pdf | 1.0 | 0.0 | 1.0 | 0.75 | 0.077 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| onboarding-guide.pdf | 1.0 | 0.0 | 1.0 | None | 0.069 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| meeting-notes.pdf | 1.0 | 0.0 | 1.0 | 1.0 | 0.068 | 1.0 | 1.0 | acme confidential corp distribute do internal |
| tech-spec.pdf | 1.0 | 0.0 | 1.0 | 1.0 | 0.062 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| faq-benefits.pdf | 1.0 | 0.0 | 1.0 | None | 0.061 | 1.0 | 1.0 | acme confidential corp distribute draft infra |
| product-catalog.2col.pdf | 1.0 | 0.0 | 1.0 | 0.893 | 0.061 | 0.66 | None | acme confidential corp distribute do draft |
| product-catalog.pdf | 1.0 | 0.0 | 1.0 | 0.893 | 0.061 | 0.66 | None | acme confidential corp distribute do draft |
| security-policy.pdf | 1.0 | 0.0 | 1.0 | None | 0.042 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| incident-postmortem.pdf | 1.0 | 0.0 | 1.0 | 1.0 | 0.041 | 1.0 | 1.0 | acme confidential corp distribute do draft |
| sheet-typed.xls | 1.0 | None | None | 0.958 | 0.038 | None | None | ledger sheet |
| sheet-typed.xlsb | 1.0 | None | None | 0.958 | 0.038 | None | None | ledger sheet |

## Tier B — real-world files vs reference extractors

| file | fmt | len | degraded | pages (ours/ref) | reference | ned | ref line recall | out line precision | noise | noise sample |
|---|---|---|---|---|---|---|---|---|---|---|
| attention.pdf | pdf | 39758 | False | 15/15 | pymupdf (39495) | 0.995 | 1.0 | 1.0 | 0.001 | df epos |
| attention.pdf | pdf | 39758 | False | 15/15 | pdfplumber (35525) | 0.847 | 0.185 | 0.2 | 0.001 | df epos |
| bitcoin.pdf | pdf | 21308 | False | 9/9 | pymupdf (21220) | 0.998 | 1.0 | 0.99 | 0.0 |  |
| bitcoin.pdf | pdf | 21308 | False | 9/9 | pdfplumber (21216) | 0.906 | 0.915 | 0.965 | 0.0 |  |
| irs-f1040.pdf | pdf | 10179 | False | 2/2 | pymupdf (10156) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| irs-f1040.pdf | pdf | 10179 | False | 2/2 | pdfplumber (10152) | 0.8 | 0.739 | 0.843 | 0.0 |  |
| irs-p17.pdf | pdf | 951010 | False | 142/142 | pymupdf (960116) | 0.975 | 1.0 | 1.0 | 0.0 |  |
| irs-p17.pdf | pdf | 951010 | False | 142/142 | pdfplumber (431054) | 0.288 | 0.215 | 0.855 | 0.0 |  |
| lo-fdo38244.odt | odt | 16 | False |  | pandoc (16) | 1.0 | None | None | 0.0 |  |
| lo-lists.odt | odt | ERROR | | | | | | | | No text could be extracted from this OpenDocument file |
| lo-simple.odp | odp | 37 | False |  | (none) | | | |  | |
| lo-simple.ods | ods | 11812 | False |  | (none) | | | |  | |
| lo-tables.odt | odt | 17 | False |  | (none) | | | |  | |
| mdn-fetch.html | html | 6589 | False |  | (none) | | | |  | |
| omnidocbench.pdf | pdf | 103309 | False | 32/32 | pymupdf (102111) | 0.984 | 1.0 | 1.0 | 0.003 | 10190 2011年1月1日 7000 aaaaa ajhb bf00326833 |
| omnidocbench.pdf | pdf | 103309 | False | 32/32 | pdfplumber (100495) | 0.351 | 0.365 | 0.42 | 0.003 | 10190 2011年1月1日 7000 aaaaa ajhb bf00326833 |
| pdf-reference-excerpt.pdf | pdf | 14 | False | 1/1 | pymupdf (14) | 1.0 | None | None | 0.0 |  |
| pdf-reference-excerpt.pdf | pdf | 14 | False | 1/1 | pdfplumber (14) | 1.0 | None | None | 0.0 |  |
| poi-basic.ppt | ppt | ERROR | | | | | | | | Unsupported file type: ppt. Supported types are: pdf, csv, d |
| poi-bug-tables.doc | doc | ERROR | | | | | | | | This .doc file uses a Word 6/95 format that is not supported |
| poi-bullets.ppt | ppt | ERROR | | | | | | | | Unsupported file type: ppt. Supported types are: pdf, csv, d |
| poi-footnotes.docx | docx | 49 | False |  | python-docx (33) | 0.717 | 1.0 | 1.0 | 0.0 |  |
| poi-footnotes.docx | docx | 49 | False |  | pandoc (47) | 0.957 | 1.0 | 1.0 | 0.0 |  |
| poi-header-footer.doc | doc | 507 | False |  | (none) | | | |  | |
| poi-headerfooter.docx | docx | ERROR | | | | | | | | No text could be extracted from this DOCX file |
| poi-layouts.pptx | pptx | 605 | False |  | python-pptx (650) | 0.903 | 0.5 | 1.0 | 0.0 |  |
| poi-lists.doc | doc | 530 | False |  | (none) | | | |  | |
| poi-multisheet.xls | xls | 133 | False |  | (none) | | | |  | |
| poi-notes.pptx | pptx | 2288 | False |  | python-pptx (2357) | 0.963 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.docx | docx | 1544 | False |  | python-docx (1542) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.docx | docx | 1544 | False |  | pandoc (1542) | 1.0 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.pptx | pptx | 139 | False |  | python-pptx (152) | 0.895 | 1.0 | 1.0 | 0.0 |  |
| poi-sample.xlsx | xlsx | 391 | False |  | openpyxl (292) | 0.753 | 1.0 | 0.5 | 0.019 | empty |
| poi-sampledoc.doc | doc | 137 | False |  | (none) | | | |  | |
| poi-simple.xls | xls | 144 | False |  | (none) | | | |  | |
| poi-tables.ppt | ppt | ERROR | | | | | | | | Unsupported file type: ppt. Supported types are: pdf, csv, d |
| w3c-html-spec-intro.html | html | 54959 | False |  | (none) | | | |  | |
| wiki-rag.html | html | 24261 | False |  | (none) | | | |  | |

## Robustness

| case | expected | passed | outcome |
|---|---|---|---|
| csv-labelled-xlsx | typed error OR correct UTF-8 text | ✅ | ok 3594 chars |
| docx-bytes-labelled-pdf | typed error OR correct text (magic wins) | ✅ | ok 856 chars |
| docx-labelled-doc | correct text | ✅ | ok 856 chars |
| docx-labelled-xlsx | typed error OR correct text (magic wins) | ✅ | ok 856 chars |
| empty.docx | typed error | ✅ | typed empty_input: Empty buffer provided |
| html-labelled-txt | markup stripped or typed error | ✅ | ok 891 chars |
| latin1-txt | text decodes to "Café résumé naïve £" | ✅ | ok 22 chars |
| pdf-bytes-labelled-docx | typed error OR correct text | ✅ | ok 937 chars |
| png-labelled-doc | typed error, never placeholder prose | ✅ | typed invalid_format: File content does not match the .doc extension (detected binary). Re-save it as DOCX and r |
| pptx-labelled-ppt | typed unsupported_type (.ppt refused) OR correct text | ✅ | typed unsupported_type: Unsupported file type: ppt. Supported types are: pdf, csv, doc, docx, docm, dotx, txt, md, |
| random-bytes-labelled-ppt | typed error, never placeholder prose | ✅ | typed unsupported_type: Unsupported file type: ppt. Supported types are: pdf, csv, doc, docx, docm, dotx, txt, md, |
| truncated-docx | typed error (invalid_format) | ✅ | typed invalid_format: Unable to inspect ZIP central directory; refusing to parse an unverifiable ZIP-shaped arch |
| truncated-pdf | typed error (invalid_format) | ✅ | typed invalid_format: Invalid PDF: Invalid PDF structure. |
| utf16-txt | text decodes to "Hello UTF-16 world" | ✅ | ok 18 chars |
