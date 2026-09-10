#!/bin/sh
# Downloads the Tier B real-world corpus into $1/real. Failures are logged, not fatal.
set -u
OUT="$1/real"
mkdir -p "$OUT"
get() { # name url
  if [ -s "$OUT/$1" ]; then return; fi
  curl -sSL -f --max-time 60 -A "Mozilla/5.0 sim-parser-eval" -o "$OUT/$1" "$2" || echo "FAILED $1 $2"
}
POI=https://raw.githubusercontent.com/apache/poi/trunk/test-data
LO=https://raw.githubusercontent.com/LibreOffice/core/master
# PDFs: two-column paper, benchmark paper, tax form, long report, slides-as-pdf
get attention.pdf https://arxiv.org/pdf/1706.03762
get omnidocbench.pdf https://arxiv.org/pdf/2412.07626
get irs-f1040.pdf https://www.irs.gov/pub/irs-pdf/f1040.pdf
get irs-p17.pdf https://www.irs.gov/pub/irs-pdf/p17.pdf
get pdf-reference-excerpt.pdf https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
get bitcoin.pdf https://bitcoin.org/bitcoin.pdf
get gao-report.pdf https://www.gao.gov/assets/gao-24-106221.pdf
# DOCX / DOC (Apache POI test corpus)
get poi-sampledoc.doc $POI/document/SampleDoc.doc
get poi-bug-tables.doc $POI/document/Bug49933.doc
get poi-lists.doc $POI/document/Lists.doc
get poi-header-footer.doc $POI/document/HeaderFooterUnicode.doc
get poi-sample.docx $POI/document/sample.docx
get poi-tables.docx $POI/document/testTables.docx
get poi-headerfooter.docx $POI/document/headerFooter.docx
get poi-footnotes.docx $POI/document/footnotes.docx
get poi-numbering.docx $POI/document/numbering.docx
get poi-bug-toc.docx $POI/document/Bug53008.docx
# PPTX / PPT
get poi-sample.pptx $POI/slideshow/sample.pptx
get poi-basic-table.pptx $POI/slideshow/basic_table.pptx
get poi-notes.pptx $POI/slideshow/45541_Header.pptx
get poi-layouts.pptx $POI/slideshow/layouts.pptx
get poi-basic.ppt $POI/slideshow/basic_test_ppt_file.ppt
get poi-tables.ppt $POI/slideshow/table_test.ppt
get poi-bullets.ppt $POI/slideshow/bullets.ppt
# XLSX / XLS
get poi-sample.xlsx $POI/spreadsheet/sample.xlsx
get poi-formulas.xlsx $POI/spreadsheet/FormulaEvalTestData.xlsx
get poi-dates.xlsx $POI/spreadsheet/DateFormats.xlsx
get poi-simple.xls $POI/spreadsheet/SimpleWithFormula.xls
get poi-multisheet.xls $POI/spreadsheet/SimpleMultiCell.xls
get poi-unicode.xls $POI/spreadsheet/Unicode.xls
# ODT / ODP / ODS (LibreOffice regression corpus)
get lo-fdo38244.odt $LO/sw/qa/extras/odfexport/data/fdo38244.odt
get lo-tables.odt $LO/sw/qa/extras/odfexport/data/fdo79358.odt
get lo-lists.odt $LO/sw/qa/extras/odfexport/data/tdf103567.odt
get lo-simple.odp $LO/sd/qa/unit/data/odp/tdf90626.odp
get lo-table.odp $LO/sd/qa/unit/data/odp/tdf91378.odp
get lo-simple.ods $LO/sc/qa/unit/data/ods/functions.ods
# HTML
get wiki-rag.html "https://en.wikipedia.org/wiki/Retrieval-augmented_generation"
get mdn-fetch.html "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"
get w3c-html-spec-intro.html "https://html.spec.whatwg.org/multipage/introduction.html"
ls -la "$OUT" | awk '{print $5, $9}'
