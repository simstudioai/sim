#!/bin/bash
# Builds lists/plan_office.tsv from GitHub fixture directories (office + pdf test corpora).
BENCH="$(cd "$(dirname "$0")" && pwd)"; source "$BENCH/lib.sh"
L="$BENCH/lists"; mkdir -p "$L"; P="$L/plan_office.tsv"; : > "$P"
lst(){ [ -s "$L/$1.tsv" ] || ls_gh "$2" "$3" > "$L/$1.tsv"; }
lst poi_document apache/poi test-data/document &
lst poi_slideshow apache/poi test-data/slideshow &
lst poi_spreadsheet apache/poi test-data/spreadsheet &
lst pydocx python-openxml/python-docx tests/test_files &
lst mammoth mwilliamson/mammoth.js test/test-data &
lst lo_ooxmlexport LibreOffice/core sw/qa/extras/ooxmlexport/data &
lst lo_ooxmlimport LibreOffice/core sw/qa/extras/ooxmlimport/data &
lst lo_ww8export LibreOffice/core sw/qa/extras/ww8export/data &
lst lo_ww8import LibreOffice/core sw/qa/extras/ww8import/data &
lst lo_pptx LibreOffice/core sd/qa/unit/data/pptx &
lst lo_ppt LibreOffice/core sd/qa/unit/data/ppt &
lst lo_odp LibreOffice/core sd/qa/unit/data/odp &
lst lo_ods LibreOffice/core sc/qa/unit/data/ods &
lst lo_xls LibreOffice/core sc/qa/unit/data/xls &
lst lo_xlsx LibreOffice/core sc/qa/unit/data/xlsx &
lst lo_xlsb LibreOffice/core sc/qa/unit/data/xlsb &
lst lo_xlsm LibreOffice/core sc/qa/unit/data/xlsm &
lst lo_odfexport LibreOffice/core sw/qa/extras/odfexport/data &
lst lo_odfimport LibreOffice/core sw/qa/extras/odfimport/data &
lst pypptx scanny/python-pptx tests/test_files &
lst unstructured Unstructured-IO/unstructured example-docs &
lst pdfjs mozilla/pdf.js test/pdfs &
lst pdfplumber jsvine/pdfplumber tests/pdfs &
wait
# docx 100
pick docx 40 poi < $L/poi_document.tsv >> $P; pick docx 4 pydocx < $L/pydocx.tsv >> $P; pick docx 17 mammoth < $L/mammoth.tsv >> $P
pick docx 22 lo < $L/lo_ooxmlexport.tsv >> $P; pick docx 8 loimp < $L/lo_ooxmlimport.tsv >> $P; pick docx 12 unstr < $L/unstructured.tsv >> $P
# doc 50
pick doc 28 poi < $L/poi_document.tsv >> $P; pick doc 16 lo < $L/lo_ww8export.tsv >> $P; pick doc 4 loimp < $L/lo_ww8import.tsv >> $P; pick doc 4 unstr < $L/unstructured.tsv >> $P
# pptx 70
pick pptx 30 poi < $L/poi_slideshow.tsv >> $P; pick pptx 25 lo < $L/lo_pptx.tsv >> $P; pick pptx 6 pypptx < $L/pypptx.tsv >> $P; pick pptx 11 unstr < $L/unstructured.tsv >> $P
# ppt 30
pick ppt 18 poi < $L/poi_slideshow.tsv >> $P; pick ppt 12 lo < $L/lo_ppt.tsv >> $P; pick ppt 1 unstr < $L/unstructured.tsv >> $P
# spreadsheets (SheetJS/test_files returns HTTP 403 "Repository access blocked" -> LibreOffice used instead)
pick xlsx 40 poi < $L/poi_spreadsheet.tsv >> $P; pick xlsx 24 lo < $L/lo_xlsx.tsv >> $P; pick xlsx 8 unstr < $L/unstructured.tsv >> $P
pick xls 26 poi < $L/poi_spreadsheet.tsv >> $P; pick xls 16 lo < $L/lo_xls.tsv >> $P; pick xls 1 unstr < $L/unstructured.tsv >> $P
pick xlsb 11 poi < $L/poi_spreadsheet.tsv >> $P; pick xlsb 7 lo < $L/lo_xlsb.tsv >> $P
pick xlsm 14 poi < $L/poi_spreadsheet.tsv >> $P; pick xlsm 3 lo < $L/lo_xlsm.tsv >> $P
# odf
pick ods 32 lo < $L/lo_ods.tsv >> $P
pick odt 24 loexp < $L/lo_odfexport.tsv >> $P; pick odt 18 loimp < $L/lo_odfimport.tsv >> $P; pick odt 2 unstr < $L/unstructured.tsv >> $P
pick odp 27 lo < $L/lo_odp.tsv >> $P
# pdf test corpora (pdf.js: only real checked-in files, .link entries are excluded by extension filter)
pick pdf 18 pdfjs < $L/pdfjs.tsv >> $P; pick pdf 12 pdfplumber < $L/pdfplumber.tsv >> $P; pick pdf 1 unstr < $L/unstructured.tsv >> $P
wc -l "$P"
