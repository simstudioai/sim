# Before/after benchmark

961 files compared. Gate: recall −0.02, vocab recall −0.02, noise +0.02, glued +1, junk +0.5, ok→error (except intended), now-degraded.

**Regressions: 57**

| ext | n | ok before→after | typed errors b→a | degraded b→a | recall b→a | ref_vocab_recall b→a | precision b→a | noise b→a | glued b→a | lines b→a | repeated_lines b→a | page_number_lines b→a | junk b→a | chunks b→a | ms b→a |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| csv | 52 | 52→52 | 0→0 | 0→0 | 0.556→0.556 | 0.657→0.657 | 0.506→0.506 | 0.578→0.578 | 0.115→0.115 | 561.558→561.558 | 1.423→1.423 | 0.019→0.019 | 0.000→0.000 | 7.135→7.135 | 12.074→12.369 |
| doc | 51 | 51→41 | 0→10 | 51→0 | 0.522→0.793 | 0.537→0.934 | 0.426→0.891 | 0.761→0.057 | 0.043→0.000 | 1.000→13.902 | 0.000→0.780 | 0.000→0.390 | 0.000→0.000 | 1.157→1.146 | 1.407→0.816 |
| docx | 102 | 81→84 | 16→18 | 0→0 | 0.830→0.830 | 0.936→0.962 | 0.985→0.920 | 0.040→0.040 | 0.038→0.051 | 163.728→44.298 | 77.802→6.643 | 26.321→0.024 | 0.002→0.001 | 2.136→2.310 | 22.842→14.846 |
| html | 60 | 60→60 | 0→0 | 0→0 | 0.791→0.795 | 0.971→0.973 | 0.636→0.616 | 0.204→0.207 | 15.900→9.467 | 2078.383→1141.517 | 776.833→196.833 | 20.050→4.833 | 0.009→0.009 | 29.817→31.200 | 41.769→47.275 |
| json | 31 | 30→30 | 1→1 | 0→0 | 0.990→0.990 | 0.982→0.982 | 0.994→0.994 | 0.169→0.169 | 1.033→1.033 | 19655.467→19655.467 | 17489.333→17489.333 | 2.000→2.000 | 0.051→0.051 | 116.133→116.133 | 3.446→3.349 |
| md | 38 | 38→38 | 0→0 | 0→0 | 1.000→1.000 | 0.996→0.996 | 1.000→1.000 | 0.039→0.039 | 0.289→0.289 | 162.289→162.289 | 12.211→12.211 | 0.026→0.026 | 0.000→0.000 | 4.605→4.605 | 0.298→0.311 |
| odp | 27 | 13→13 | 14→14 | 0→0 | —→— | —→— | —→— | —→— | —→— | 3.615→3.846 | 0.231→0.231 | 0.231→0.077 | 0.000→0.000 | 1.000→1.000 | 0.804→0.527 |
| ods | 32 | 32→32 | 0→0 | 6→6 | 0.839→0.927 | 0.976→0.976 | 0.544→0.615 | 0.350→0.327 | 0.000→0.000 | 26.438→26.438 | 0.188→0.344 | 0.594→0.812 | 0.000→0.000 | 1.000→1.000 | 1.333→1.326 |
| odt | 44 | 33→32 | 11→12 | 0→0 | 0.892→0.861 | 0.867→0.970 | 0.838→0.844 | 0.182→0.079 | 0.296→0.037 | 6.182→5.719 | 0.727→0.438 | 0.576→0.031 | 0.000→0.000 | 1.061→1.125 | 0.638→0.416 |
| pdf | 190 | 190→190 | 0→0 | 0→0 | 0.991→0.991 | 0.977→0.976 | 0.983→0.979 | 0.116→0.102 | 3.158→1.234 | 0.968→1466.974 | 0.000→107.095 | 0.000→9.668 | 0.340→0.343 | 23.753→29.295 | 95.589→123.093 |
| ppt | 30 | 30→0 | 0→30 | 30→0 | —→— | —→— | —→— | —→— | —→— | 1.000→— | 0.000→— | 0.000→— | 0.000→— | 1.500→— | 0.993→— |
| pptx | 72 | 66→44 | 2→28 | 20→0 | 0.979→0.903 | 0.997→0.980 | 1.000→0.878 | 0.060→0.055 | 0.000→0.000 | 101.561→142.750 | 68.727→98.864 | 9.152→6.841 | 0.003→0.005 | 1.985→2.682 | 7.143→5.018 |
| txt | 42 | 42→42 | 0→0 | 0→0 | 0.999→1.000 | 0.966→0.974 | 1.000→1.000 | 0.044→0.040 | 8.405→5.071 | 8124.310→8124.310 | 461.381→461.190 | 0.119→0.119 | 0.000→0.000 | 126.381→126.643 | 11.934→11.675 |
| xls | 43 | 43→43 | 0→0 | 4→4 | 0.806→0.924 | 0.961→0.961 | 0.650→0.722 | 0.329→0.357 | 0.000→0.000 | 104.419→104.419 | 5.047→5.047 | 0.535→0.535 | 0.000→0.000 | 3.023→2.977 | 6.399→6.320 |
| xlsb | 17 | 17→17 | 0→0 | 1→1 | 1.000→1.000 | 0.948→0.933 | 0.671→0.671 | 0.244→0.263 | 0.000→0.000 | 27.824→27.824 | 2.000→2.000 | 2.882→2.882 | 0.509→0.509 | 1.000→1.000 | 1.326→1.295 |
| xlsm | 17 | 16→16 | 1→1 | 5→5 | 0.850→0.575 | 0.926→0.930 | 0.436→0.200 | 0.342→0.382 | 0.000→0.000 | 60.875→59.125 | 15.188→13.375 | 1.812→0.375 | 0.000→0.000 | 7.188→5.188 | 11.411→11.552 |
| xlsx | 71 | 68→68 | 0→3 | 11→11 | 0.911→0.955 | 0.981→0.983 | 0.636→0.660 | 0.253→0.263 | 0.045→0.045 | 90.706→90.706 | 2.176→2.147 | 1.015→1.000 | 0.342→0.342 | 3.088→3.132 | 10.536→9.804 |
| yaml | 42 | 39→39 | 3→3 | 0→0 | 0.829→0.829 | 0.858→0.858 | 0.412→0.412 | 0.121→0.121 | 0.154→0.154 | 209.641→209.641 | 121.205→121.205 | 0.333→0.333 | 0.000→0.000 | 1.872→1.872 | 0.268→0.263 |

## Flags per file

| file | flags |
|---|---|
| doc__lo__comments-nested.doc | REGRESSION:vocab-recall 0.9231->0.6154 |
| doc__lo__fdo77844.doc | REGRESSION:vocab-recall 0.9859->0.8873 |
| doc__lo__tdf127166_prstDash_Word97.doc | CHECK:length 316->116 (no reference) |
| doc__lo__tdf49102_mergedCellNumbering.doc | intended:ok->typed-error |
| doc__lo__tdf75539_relativeWidth.doc | CHECK:length 1392->49 (no reference) |
| doc__lo__tdf98284_softLockedFields.doc | REGRESSION:recall 0.5->0.0 |
| doc__loimp__image-lazy-read-0size.doc | intended:ok->typed-error |
| doc__poi__47304.doc | CHECK:length 668->14 (no reference) |
| doc__poi__52117.doc | intended:ok->typed-error |
| doc__poi__57843.doc | intended:ok->typed-error |
| doc__poi__Bug47958.doc | REGRESSION:recall 1.0->0.9474 |
| doc__poi__Bug50955.doc | intended:ok->typed-error |
| doc__poi__Bug60936.doc | intended:ok->typed-error |
| doc__poi__HeaderWithMacros.doc | REGRESSION:recall 1.0->0.0 |
| doc__poi__Word6_sections.doc | intended:ok->typed-error |
| doc__poi__ca.kwsymphony.www_education_School_Concert_Seat_Booking_Form_2011-12.doc | REGRESSION:recall 1.0->0.8947; REGRESSION:vocab-recall 0.9896->0.9583 |
| doc__poi__clusterfuzz-testcase-minimized-POIHWPFFuzzer-4951943183990784.doc | intended:ok->typed-error |
| doc__poi__clusterfuzz-testcase-minimized-POIHWPFFuzzer-5832867957309440.doc | intended:ok->typed-error |
| doc__poi__simple-table2.doc | CHECK:length 801->118 (no reference) |
| doc__poi__testCroppedPictures.doc | CHECK:length 582->18 (no reference) |
| doc__poi__vector_image.doc | intended:ok->typed-error |
| doc__unstr__fake-doc-emphasized-text.doc | REGRESSION:recall 1.0->0.5; REGRESSION:vocab-recall 1.0->0.7143 |
| docx__lo__FDO76312.docx | REGRESSION:recall 1.0->0.5 |
| docx__lo__n780563.docx | improved:error->ok |
| docx__lo__table-style-border.docx | improved:error->ok |
| docx__mammoth__tables.docx | REGRESSION:recall 0.4->0.2 |
| docx__poi__59030.docx | REGRESSION:recall 0.25->0.0 |
| docx__poi__TestTableColumns.docx | improved:error->ok |
| docx__poi__bug65649.docx | REGRESSION:glued 2->3 |
| docx__poi__clusterfuzz-testcase-minimized-POIFuzzer-6709287337197568.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-4961551840247808.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-5564805011079168.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-6442791109263360.docx | improved:untyped->typed |
| docx__poi__crash-517626e815e0afa9decd0ebb6d1dee63fb9907dd.docx | improved:untyped->typed |
| docx__poi__table_footnotes.docx | REGRESSION:recall 0.25->0.0 |
| ods__lo__cachedValue.ods | CHECK:length 785->412 (no reference) |
| ods__lo__formula-across-sheets.ods | REGRESSION:recall 1.0->0.2222 |
| ods__lo__tdf134234.ods | REGRESSION:noise 0.5333->0.65 |
| ods__lo__tdf160003_page_anchored_object.ods | CHECK:length 753->236 (no reference) |
| ods__lo__test_borders_export.ods | REGRESSION:recall 1.0->0.9; REGRESSION:noise 0.1731->0.3175 |
| odt__loexp__redlineTextFrame.odt | REGRESSION:ok->error |
| odt__loexp__tdf169882.odt | REGRESSION:glued 0->1 |
| odt__unstr__fake.odt | REGRESSION:recall 0.7143->0.1429 |
| pdf__arxiv__2606.21840.pdf | REGRESSION:vocab-recall 0.9552->0.9286 |
| pdf__arxiv__2606.22035.pdf | REGRESSION:vocab-recall 0.9834->0.954 |
| pdf__arxiv__2606.26142.pdf | REGRESSION:vocab-recall 0.9682->0.9353 |
| pdf__arxiv__2609.09039.pdf | REGRESSION:vocab-recall 0.988->0.9654 |
| pdf__arxiv__2609.09538.pdf | REGRESSION:vocab-recall 0.9845->0.9619 |
| pdf__arxiv__2609.09831.pdf | REGRESSION:vocab-recall 0.9685->0.9436 |
| pdf__pdfjs__file_pdfjs_form.pdf | REGRESSION:vocab-recall 1.0->0.875 |
| pdf__slides__jeremytammik_tbc_ar20462_angel_velez_ifc_slides.pdf | REGRESSION:junk 11.63->12.79 |
| pdf__slides__wzpan_BeamerStyleSlides_slides.pdf | CHECK:length 575->298 (no reference) |
| ppt__lo__FillPatterns.ppt | intended:ok->typed-error |
| ppt__lo__fdo68594.ppt | intended:ok->typed-error |
| ppt__lo__indent_multiple_spacings.ppt | intended:ok->typed-error |
| ppt__lo__ppt-indentation-bullets.ppt | intended:ok->typed-error |
| ppt__lo__tdf115394.ppt | intended:ok->typed-error |
| ppt__lo__tdf122899_Arc_90_to_91_clockwise.ppt | intended:ok->typed-error |
| ppt__lo__tdf136911.ppt | intended:ok->typed-error |
| ppt__lo__tdf157636.ppt | intended:ok->typed-error |
| ppt__lo__tdf168736-1.ppt | intended:ok->typed-error |
| ppt__lo__tdf168786.ppt | intended:ok->typed-error |
| ppt__lo__tdf49561.ppt | intended:ok->typed-error |
| ppt__lo__tdf77747.ppt | intended:ok->typed-error |
| ppt__poi__119877_all_type_background_save_by_AOO.ppt | intended:ok->typed-error |
| ppt__poi__41246-2.ppt | intended:ok->typed-error |
| ppt__poi__44296.ppt | intended:ok->typed-error |
| ppt__poi__49648.ppt | intended:ok->typed-error |
| ppt__poi__54541_cropped_bitmap.ppt | intended:ok->typed-error |
| ppt__poi__60294.ppt | intended:ok->typed-error |
| ppt__poi__WithLinks.ppt | intended:ok->typed-error |
| ppt__poi__br.com.tvcamboriu.www_pps_Pensar_5b1_5d.ppt | intended:ok->typed-error |
| ppt__poi__bug53192.ppt | intended:ok->typed-error |
| ppt__poi__bug58159_headers-and-footers.ppt | intended:ok->typed-error |
| ppt__poi__bug60345_paperfigures.ppt | intended:ok->typed-error |
| ppt__poi__cf5f6fde99a8b3ea5a4946c258b7abad6f30b0c5.ppt | intended:ok->typed-error |
| ppt__poi__clusterfuzz-testcase-minimized-POIHSLFFuzzer-5018229722382336.ppt | intended:ok->typed-error |
| ppt__poi__clusterfuzz-testcase-minimized-POIHSLFFuzzer-6416153805979648.ppt | intended:ok->typed-error |
| ppt__poi__headers_footers.ppt | intended:ok->typed-error |
| ppt__poi__npe.ppt | intended:ok->typed-error |
| ppt__poi__ppt_with_png.ppt | intended:ok->typed-error |
| ppt__unstr__fake-power-point.ppt | intended:ok->typed-error |
| pptx__lo__activex_spinbutton.pptx | intended:ok->typed-error |
| pptx__lo__bnc870233_2.pptx | intended:ok->typed-error |
| pptx__lo__crop-to-shape.pptx | intended:ok->typed-error |
| pptx__lo__group-rot.pptx | intended:ok->typed-error |
| pptx__lo__shape-blur-effect.pptx | intended:ok->typed-error |
| pptx__lo__smartart-children.pptx | intended:ok->typed-error |
| pptx__lo__smartart-org-chart2.pptx | intended:ok->typed-error |
| pptx__lo__tdf111884.pptx | intended:ok->typed-error |
| pptx__lo__tdf125346.pptx | intended:ok->typed-error |
| pptx__lo__tdf134053_dashdot.pptx | intended:ok->typed-error |
| pptx__lo__tdf151767.pptx | intended:ok->typed-error |
| pptx__poi__54542_cropped_bitmap.pptx | intended:ok->typed-error |
| pptx__poi__EmbeddedVideo.pptx | intended:ok->typed-error |
| pptx__poi__au.asn.aes.www_conferences_2011_presentations_Fri_20Room4Level4_20930_20Maloney.pptx | improved:untyped->typed |
| pptx__poi__bug54570.pptx | intended:ok->typed-error |
| pptx__poi__bug60715.pptx | intended:ok->typed-error |
| pptx__poi__chart-slide-bg.pptx | intended:ok->typed-error |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-4838644450394112.pptx | improved:untyped->typed |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-5471515212382208.pptx | improved:untyped->typed |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-6254434927378432.pptx | improved:untyped->typed |
| pptx__poi__crash-57308ca363f5b71763c489d1b432aff009d4bc4f.pptx | intended:ok->typed-error |
| pptx__poi__layouts.pptx | REGRESSION:recall 1.0->0.5; REGRESSION:vocab-recall 1.0->0.8718 |
| pptx__poi__missing-blip-fill.pptx | REGRESSION:ok->error |
| pptx__poi__sample_pptx_grouping_issues.pptx | REGRESSION:ok->error |
| pptx__poi__smartart-rotated-text.pptx | intended:ok->typed-error |
| pptx__poi__table_test2.pptx | REGRESSION:recall 0.8333->0.1667 |
| pptx__unstr__fake-power-point-malformed.pptx | REGRESSION:vocab-recall 1.0->0.4 |
| pptx__unstr__fake-power-point-table.pptx | REGRESSION:recall 1.0->0.0 |
| pptx__unstr__picture.pptx | intended:ok->typed-error |
| pptx__unstr__test-image-jpg-mime.pptx | intended:ok->typed-error |
| xls__lo__formats.xls | REGRESSION:noise 0.3256->0.4528 |
| xls__lo__pivottable_bool_field_filter.xls | REGRESSION:noise 0.2162->0.3696 |
| xls__lo__pivottable_empty_item.xls | REGRESSION:noise 0.2222->0.3333 |
| xls__lo__pivottable_rowcolpage_field_filter.xls | REGRESSION:noise 0.2105->0.3182 |
| xls__lo__tdf112501.xls | REGRESSION:noise 0.34->0.3774 |
| xls__poi__12561-1.xls | REGRESSION:noise 0.2581->0.4561 |
| xls__poi__45672.xls | REGRESSION:recall 1.0->0.0 |
| xls__poi__BOOK_in_capitals.xls | REGRESSION:noise 0.0652->0.1042 |
| xls__poi__IfFunctionTestCaseData.xls | REGRESSION:noise 0.1283->0.1783 |
| xls__poi__XRefCalcData.xls | REGRESSION:noise 0.1111->0.2 |
| xls__poi__crash-e329fca9087fe21bca4a80c8bc472a661c98d860.xls | REGRESSION:noise 0.1667->0.375 |
| xls__poi__styles-3563.xls | REGRESSION:recall 0.883->0.7872 |
| xlsb__poi__62815.xlsb | REGRESSION:vocab-recall 0.625->0.375 |
| xlsb__poi__date.xlsb | REGRESSION:noise 0.3333->0.6 |
| xlsb__poi__testVarious.xlsb | REGRESSION:noise 0.2653->0.2941 |
| xlsm__poi__57181.xlsm | REGRESSION:recall 0.9735->0.1746; REGRESSION:noise 0.2084->0.7645 |
| xlsm__poi__60512.xlsm | REGRESSION:recall 0.975->0.425 |
| xlsm__poi__61495-test.xlsm | REGRESSION:noise 0.7143->0.7778 |
| xlsm__poi__mv-calculator-final-2-20-2013.xlsm | REGRESSION:recall 1.0->0.4233 |
| xlsx__lo__different-column-width-excel2010.xlsx | improved:untyped->typed |
| xlsx__lo__pivottable_1s_difference.xlsx | REGRESSION:noise 0.3636->0.5882 |
| xlsx__lo__tdf147955.xlsx | REGRESSION:noise 0.1356->0.2609 |
| xlsx__lo__tdf170298.xlsx | REGRESSION:noise 0.2959->0.4413 |
| xlsx__poi__56730.xlsx | REGRESSION:noise 0.3333->0.4286 |
| xlsx__poi__NumberFormatApproxTests.xlsx | REGRESSION:noise 0.6337->0.6944 |
| xlsx__poi__clusterfuzz-testcase-minimized-POIXSSFFuzzer-4828727001088000.xlsx | improved:untyped->typed |
| xlsx__poi__clusterfuzz-testcase-minimized-XLSX2CSVFuzzer-5542865479270400.xlsx | improved:untyped->typed |
| xlsx__unstr__2023-half-year-analyses-by-segment.xlsx | REGRESSION:recall 1.0->0.6389 |
