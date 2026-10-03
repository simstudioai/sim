# Before/after benchmark

961 files compared. Gate: recall −0.02, vocab recall −0.02, noise +0.02, glued +1, junk +0.5, ok→error (except intended), now-degraded; CHECK flags for count-aware word depletion (a reference word whose occurrences fell by more than half) and for ≥5 reference words present before and absent after.

**Regressions: 53**

| ext | n | ok before→after | typed errors b→a | degraded b→a | recall b→a | ref_vocab_recall b→a | precision b→a | noise b→a | glued b→a | lines b→a | repeated_lines b→a | page_number_lines b→a | junk b→a | chunks b→a | ms b→a |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| csv | 52 | 52→52 | 0→0 | 0→0 | 0.373→0.373 | 0.657→0.657 | 0.519→0.519 | 0.088→0.088 | 0.115→0.115 | 561.558→561.558 | 1.423→1.423 | 0.019→0.019 | 0.000→0.000 | 7.135→7.135 | 12.074→12.713 |
| doc | 51 | 51→41 | 0→10 | 51→0 | 0.522→0.794 | 0.537→0.935 | 0.426→0.891 | 0.753→0.003 | 0.043→0.000 | 1.000→14.000 | 0.000→0.829 | 0.000→0.390 | 0.000→0.000 | 1.157→1.146 | 1.407→0.743 |
| docx | 102 | 81→84 | 16→18 | 0→0 | 0.830→0.816 | 0.936→0.962 | 0.985→0.922 | 0.001→0.001 | 0.038→0.051 | 163.728→43.893 | 77.802→6.583 | 26.321→0.024 | 0.002→0.002 | 2.136→2.238 | 22.842→18.123 |
| html | 60 | 60→60 | 0→0 | 0→0 | 0.709→0.711 | 0.971→0.974 | 0.691→0.672 | 0.146→0.148 | 15.900→7.250 | 2078.383→1118.967 | 776.833→194.567 | 20.050→4.833 | 0.009→0.009 | 29.817→27.250 | 41.769→50.499 |
| json | 31 | 30→31 | 1→0 | 0→0 | 0.989→0.985 | 0.982→0.974 | 0.994→0.995 | 0.002→0.002 | 1.033→1.000 | 19655.467→19023.323 | 17489.333→16925.161 | 2.000→1.935 | 0.051→0.049 | 116.133→112.419 | 3.446→3.542 |
| md | 38 | 38→38 | 0→0 | 0→0 | 1.000→1.000 | 0.996→0.996 | 1.000→1.000 | 0.000→0.000 | 0.289→0.289 | 162.289→162.289 | 12.211→12.211 | 0.026→0.026 | 0.000→0.000 | 4.605→4.605 | 0.298→0.309 |
| odp | 27 | 13→14 | 14→13 | 0→0 | —→— | —→— | —→— | —→— | —→— | 3.615→3.429 | 0.231→0.214 | 0.231→0.071 | 0.000→0.000 | 1.000→1.000 | 0.804→0.594 |
| ods | 32 | 32→32 | 0→0 | 6→6 | 0.839→0.927 | 0.976→0.976 | 0.544→0.615 | 0.148→0.065 | 0.000→0.000 | 26.438→26.438 | 0.188→0.344 | 0.594→0.812 | 0.000→0.000 | 1.000→1.000 | 1.333→1.376 |
| odt | 44 | 33→32 | 11→12 | 0→0 | 0.892→0.861 | 0.867→0.970 | 0.838→0.844 | 0.169→0.066 | 0.296→0.037 | 6.182→5.719 | 0.727→0.438 | 0.576→0.031 | 0.000→0.000 | 1.061→1.125 | 0.638→0.453 |
| pdf | 190 | 190→190 | 0→0 | 0→0 | 0.990→0.989 | 0.977→0.976 | 0.983→0.975 | 0.011→0.008 | 3.158→1.234 | 0.968→1475.468 | 0.000→115.637 | 0.000→9.911 | 0.340→0.342 | 23.753→25.032 | 95.589→97.390 |
| ppt | 30 | 30→0 | 0→30 | 30→0 | —→— | —→— | —→— | —→— | —→— | 1.000→— | 0.000→— | 0.000→— | 0.000→— | 1.500→— | 0.993→— |
| pptx | 72 | 66→44 | 2→28 | 20→0 | 0.979→0.903 | 0.997→0.980 | 1.000→0.874 | 0.000→0.001 | 0.000→0.000 | 101.561→144.432 | 68.727→99.750 | 9.152→6.841 | 0.003→0.005 | 1.985→2.682 | 7.143→5.602 |
| txt | 42 | 42→42 | 0→0 | 0→0 | 0.986→1.000 | 0.966→0.974 | 0.984→1.000 | 0.003→0.000 | 8.405→5.071 | 8124.310→8124.310 | 461.381→461.190 | 0.119→0.119 | 0.000→0.000 | 126.381→126.643 | 11.934→12.034 |
| xls | 43 | 43→43 | 0→0 | 4→4 | 0.785→0.901 | 0.961→0.961 | 0.647→0.717 | 0.070→0.075 | 0.000→0.000 | 104.419→104.326 | 5.047→5.047 | 0.535→0.535 | 0.000→0.000 | 3.023→2.977 | 6.399→6.814 |
| xlsb | 17 | 17→17 | 0→0 | 1→1 | 1.000→1.000 | 0.948→0.933 | 0.671→0.621 | 0.041→0.066 | 0.000→0.000 | 27.824→27.824 | 2.000→2.000 | 2.882→2.882 | 0.509→0.509 | 1.000→1.000 | 1.326→1.206 |
| xlsm | 17 | 16→16 | 1→1 | 5→5 | 0.850→0.562 | 0.926→0.926 | 0.435→0.214 | 0.124→0.122 | 0.000→0.000 | 60.875→53.500 | 15.188→8.375 | 1.812→0.375 | 0.000→0.000 | 7.188→4.875 | 11.411→11.305 |
| xlsx | 71 | 68→68 | 0→3 | 11→11 | 0.909→0.912 | 0.981→0.983 | 0.639→0.659 | 0.108→0.109 | 0.045→0.045 | 90.706→89.868 | 2.176→1.706 | 1.015→0.897 | 0.342→0.342 | 3.088→3.132 | 10.536→10.031 |
| yaml | 42 | 39→42 | 3→0 | 0→0 | 0.829→0.838 | 0.858→0.866 | 0.412→0.393 | 0.009→0.009 | 0.154→0.143 | 209.641→201.190 | 121.205→115.905 | 0.333→0.310 | 0.000→0.000 | 1.872→1.810 | 0.268→0.263 |

## Flags per file

| file | flags |
|---|---|
| doc__lo__comments-nested.doc | REGRESSION:vocab-recall 0.9231->0.6154 |
| doc__lo__fdo77844.doc | CHECK:lost-words 7 (bugs cgi freedesktop https hyperlink org); REGRESSION:vocab-recall 0.9859->0.8873 |
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
| doc__poi__FloatingPictures.doc | CHECK:lost-words 6 (arabic date embed seq sheet yyyy); CHECK:depleted nasa:5->2 |
| doc__poi__HeaderWithMacros.doc | REGRESSION:recall 1.0->0.0 |
| doc__poi__Word6_sections.doc | intended:ok->typed-error |
| doc__poi__ca.kwsymphony.www_education_School_Concert_Seat_Booking_Form_2011-12.doc | REGRESSION:recall 1.0->0.9474 |
| doc__poi__clusterfuzz-testcase-minimized-POIHWPFFuzzer-4951943183990784.doc | intended:ok->typed-error |
| doc__poi__clusterfuzz-testcase-minimized-POIHWPFFuzzer-5832867957309440.doc | intended:ok->typed-error |
| doc__poi__simple-table2.doc | CHECK:length 801->118 (no reference) |
| doc__poi__testCroppedPictures.doc | CHECK:length 582->18 (no reference) |
| doc__poi__vector_image.doc | intended:ok->typed-error |
| doc__unstr__fake-doc-emphasized-text.doc | REGRESSION:recall 1.0->0.5; REGRESSION:vocab-recall 1.0->0.7143 |
| docx__lo__FDO76312.docx | REGRESSION:recall 1.0->0.5 |
| docx__lo__fdo76316.docx | REGRESSION:recall 1.0->0.6667 |
| docx__lo__n780563.docx | improved:error->ok |
| docx__lo__table-style-border.docx | improved:error->ok |
| docx__mammoth__tables.docx | REGRESSION:recall 0.4->0.2 |
| docx__poi__59030.docx | REGRESSION:recall 0.25->0.0 |
| docx__poi__TestTableColumns.docx | improved:error->ok |
| docx__poi__bug65649.docx | CHECK:lost-words 7 (noп видыработ длястроительства напроектносметные разделусправочника стоистьруб); REGRESSION:recall 1.0->0.6; REGRESSION:glued 2->3 |
| docx__poi__clusterfuzz-testcase-minimized-POIFuzzer-6709287337197568.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-4961551840247808.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-5564805011079168.docx | improved:untyped->typed |
| docx__poi__clusterfuzz-testcase-minimized-POIXWPFFuzzer-6442791109263360.docx | improved:untyped->typed |
| docx__poi__crash-517626e815e0afa9decd0ebb6d1dee63fb9907dd.docx | improved:untyped->typed |
| docx__poi__table_footnotes.docx | REGRESSION:recall 0.25->0.0 |
| html__mdn__Web_Accessibility_ARIA.html | REGRESSION:noise 0.2321->0.2891 |
| html__mdn__Web_CSS_CSS_grid_layout.html | REGRESSION:noise 0.5172->0.5859 |
| html__mdn__Web_CSS_flex.html | REGRESSION:noise 0.4002->0.4932 |
| html__mdn__Web_HTML_Element_table.html | REGRESSION:glued 6->7 |
| html__mdn__Web_HTTP_Status_404.html | REGRESSION:noise 0.539->0.6055 |
| html__mdn__Web_JavaScript_Guide_Introduction.html | REGRESSION:noise 0.2999->0.3235 |
| html__wiki__Amazon_rainforest.html | CHECK:depleted east:104->17 central:90->12 south:103->31 sea:71->15 |
| html__wiki__Antarctica.html | CHECK:depleted expedition:212->47 hms:134->24 pole:90->38 amundsen:61->16 |
| html__wiki__Bach.html | CHECK:depleted hymnal:36->9 den:31->6 svenska:25->5 christian:35->15 |
| html__wiki__Black_hole.html | CHECK:depleted formulation:11->5 friedmann:11->5 formalism:11->5 |
| html__wiki__Chess.html | REGRESSION:recall 0.3533->0.2333 |
| html__wiki__Climate_change.html | CHECK:depleted forcing:26->11 model:27->12 event:22->7 country:19->7 |
| html__wiki__Coffee.html | CHECK:depleted white:15->7 |
| html__wiki__French_Revolution.html | CHECK:depleted battle:126->44 louis:127->61 charles:57->13 françois:61->21 |
| html__wiki__Mount_Everest.html | CHECK:depleted highway:42->7 himal:30->10 range:27->12 kang:23->11 |
| html__wiki__Mozart.html | CHECK:depleted conductor:13->5 |
| html__wiki__Periodic_table.html | CHECK:depleted aufbau:16->6 heat:11->5 |
| html__wiki__Photosynthesis.html | CHECK:depleted vitamin:23->10 earliest:17->7 |
| html__wiki__Renaissance.html | CHECK:depleted art:284->140 school:152->52 historical:69->31 christianity:40->14 |
| html__wiki__Roman_Empire.html | CHECK:depleted duchy:244->42 ship:130->12 boat:120->10 republic:170->66 |
| html__wiki__Shakespeare.html | CHECK:depleted the:3036->1056 and:1024->447 king:475->86 hamlet:384->65 |
| html__wiki__World_War_II.html | CHECK:depleted battle:155->77 famine:16->6 |
| json__tsconfig__prettier_prettier.json | improved:error->ok |
| odp__lo__tdf157795.odp | improved:error->ok |
| ods__lo__cachedValue.ods | CHECK:length 785->406 (no reference) |
| ods__lo__formula-across-sheets.ods | REGRESSION:recall 1.0->0.2222; REGRESSION:noise 0.0->0.0435 |
| ods__lo__tdf160003_page_anchored_object.ods | CHECK:length 753->236 (no reference) |
| ods__lo__test_borders_export.ods | REGRESSION:recall 1.0->0.9 |
| odt__loexp__redlineTextFrame.odt | REGRESSION:ok->error |
| odt__loexp__tdf169882.odt | REGRESSION:glued 0->1 |
| odt__unstr__fake.odt | REGRESSION:recall 0.7143->0.1429 |
| pdf__arxiv__2606.13260.pdf | CHECK:depleted ˆfv:9->0 |
| pdf__arxiv__2606.21569.pdf | CHECK:depleted ˆβriv:23->0 |
| pdf__arxiv__2606.21840.pdf | CHECK:lost-words 43 (b22κpˆθpy b2κpˆθpy hpnq phpnq pˆζj pˆλkqkďr); CHECK:depleted rμ1:12->0 ˆc1:12->0 ˆθpy:11->0 ˆfμ0:9->0; REGRESSION:vocab-recall 0.9552->0.9286 |
| pdf__arxiv__2606.22035.pdf | CHECK:lost-words 54 (bdi bgi bhij bti bξi bσg); CHECK:depleted ˆgi:67->0 ˆθg:43->0 ˆθˆgi:26->0 ˆθg0:24->0; REGRESSION:vocab-recall 0.9834->0.954 |
| pdf__arxiv__2606.22230.pdf | CHECK:lost-words 11 (bgperm bκ3 bκ4 bλk channel14 conse9); CHECK:depleted bλk:6->0 bgperm:5->0 |
| pdf__arxiv__2606.22255.pdf | CHECK:lost-words 23 (vˆι ˆfi ˆgc ˆgl ˆlm ˆlι); CHECK:depleted ˇμj:39->0 ˇμ1:35->0 ˇμk:13->0 ˇθj:7->0 |
| pdf__arxiv__2606.26142.pdf | CHECK:lost-words 49 (2x2 erp0 ev0 evl evp0 ezl); CHECK:depleted ˆδq:46->0 ˆcq:37->0 ˆλk:19->0 ˆgg:11->0; REGRESSION:vocab-recall 0.9682->0.9353 |
| pdf__arxiv__2608.09558.pdf | CHECK:depleted bkh:34->0 |
| pdf__arxiv__2608.09561.pdf | CHECK:depleted lˆe:14->2 bgβm:8->0 |
| pdf__arxiv__2608.09623.pdf | CHECK:lost-words 17 (ddimensional dvol dμn dωref efk egε); CHECK:depleted ˆqε:31->0 preprint:31->4 august:29->2 dvol:11->0 |
| pdf__arxiv__2608.09736.pdf | CHECK:lost-words 21 (2h1 bckm bun bvn coˆut ea2); CHECK:depleted eh1:42->0 ehn:27->0 ˆcf:17->0 ˆcehz:16->0 |
| pdf__arxiv__2608.20598.pdf | CHECK:lost-words 15 (bdj bdmart bdw bdβ bsd bset); CHECK:depleted bdw:20->0 bsd:9->0 ˆsc:8->0 bdj:8->0 |
| pdf__arxiv__2608.20601.pdf | CHECK:lost-words 7 (chomper62 chomper67 fundamen2 tal ˆλ1 ˆλ20) |
| pdf__arxiv__2608.20610.pdf | CHECK:lost-words 6 (ˆgi ˆyit ˆσ2 ˆτi ˆτit ˆτt); CHECK:depleted ˆgi:11->0 ˆτt:6->0 ˆτit:5->0 |
| pdf__arxiv__2608.20641.pdf | CHECK:lost-words 6 (2tr propor12 tion ˆβ2 ˆβmt ˆψu); CHECK:depleted ˆβmt:10->0 |
| pdf__arxiv__2608.20727.pdf | CHECK:lost-words 21 (ba2 ban bat ben bpi bpperm); CHECK:depleted ben:22->0 bzi:10->0 bηt:10->0 dba:10->0 |
| pdf__arxiv__2608.20744.pdf | CHECK:lost-words 34 (2daug 2dn 2ex 2pn bdc bdn); CHECK:depleted bθa:39->0 bηn:39->0 bdn:19->0 bθc:16->0 |
| pdf__arxiv__2608.20922.pdf | CHECK:depleted preprint:6->2 |
| pdf__arxiv__2608.21480.pdf | CHECK:lost-words 8 (cus27 descrip32 probabili24 ties tive tomer) |
| pdf__arxiv__2609.06011.pdf | CHECK:lost-words 8 (ased dif2 ferent predic19 unbi8 xperc); CHECK:depleted xperc:6->0 xprop:6->0 |
| pdf__arxiv__2609.06025.pdf | CHECK:depleted ˆu0:12->1 |
| pdf__arxiv__2609.06660.pdf | CHECK:depleted ˆcp:10->0 |
| pdf__arxiv__2609.06721.pdf | CHECK:lost-words 6 (associ6 dy8 mˆt namically vˆt ˆqt); CHECK:depleted hangyu:17->3 qin:21->7 |
| pdf__arxiv__2609.07655.pdf | CHECK:depleted preprint:18->1 |
| pdf__arxiv__2609.07666.pdf | CHECK:depleted ˆgk:15->0 wang:10->3 yao:9->2 xie:10->3 |
| pdf__arxiv__2609.07681.pdf | CHECK:lost-words 23 (ˆein ˆgi ˆx1 ˆx1α1 ˆx2 ˆx2α2); CHECK:depleted ˆxt:35->0 ˆyt:14->0 ˆxτ:11->0 ˆxd:6->0 |
| pdf__arxiv__2609.07689.pdf | CHECK:depleted ˆρj:10->0 |
| pdf__arxiv__2609.07706.pdf | CHECK:lost-words 23 (bp1 bx0 bx1 bxi bxt bxtk); CHECK:depleted exi:26->0 bx1:14->0 extk:12->0 ept:7->0 |
| pdf__arxiv__2609.07888.pdf | CHECK:lost-words 19 (2ˆτl bhblb bqlms bvbetween bvl bvwithin); CHECK:depleted ˆτhl:84->0 ˆs2:24->0 ˆτl:21->0 bvl:9->0 |
| pdf__arxiv__2609.08335.pdf | CHECK:lost-words 24 (3př 96ˆσ bkpa1 cs2 erś erˆθ); CHECK:depleted erˆθ:7->0 ˆσ2:6->0 varpˆθ:6->0 ˆθω:5->0 |
| pdf__arxiv__2609.08411.pdf | CHECK:lost-words 7 (first10 outcome3 ˆmj ˆβc ˆβe ˆτij); CHECK:depleted ˆτij:6->0 |
| pdf__arxiv__2609.08615.pdf | CHECK:depleted why:8->2 fail:10->4 preprint:8->2 |
| pdf__arxiv__2609.09039.pdf | CHECK:lost-words 51 (4yi bg0 bg1 bgas bgi bgr); CHECK:depleted bτdm:28->0 bgi:10->0 bτdir:9->0 bvdir:8->0; REGRESSION:vocab-recall 0.988->0.9654 |
| pdf__arxiv__2609.09388.pdf | CHECK:lost-words 15 (brt bsys byi eqs essys eδt); CHECK:depleted byi:5->0 |
| pdf__arxiv__2609.09436.pdf | CHECK:lost-words 11 (zk2 ˆfn ˆzn ˆα1 ˆαk ˆαkf); CHECK:depleted ˆfn:65->0 ˆκn:17->0 ˆzn:10->0 |
| pdf__arxiv__2609.09488.pdf | CHECK:lost-words 22 (bm0 bqe bqg bvg bwg bwrj); CHECK:depleted bwrj:7->0 bθj:6->0 bηk:6->0 bφp:5->0 |
| pdf__arxiv__2609.09538.pdf | CHECK:lost-words 40 (2dε bf1 bfj bfm bqb brb); CHECK:depleted bγn:68->0 bμj:56->0 gonzálezsanz:52->23 chen:50->21; REGRESSION:vocab-recall 0.9845->0.9619 |
| pdf__arxiv__2609.09588.pdf | CHECK:depleted dependence:36->14 nunes:26->4 |
| pdf__arxiv__2609.09600.pdf | CHECK:lost-words 15 (bjp bw2 bwp bρp bσ2 bτp); CHECK:depleted bwp:13->0 bjp:8->0 bτp:8->0 bρp:6->0 |
| pdf__arxiv__2609.09831.pdf | CHECK:lost-words 62 (4αpμ0 bhi bγ2 bγδp bδ2 bζ2); CHECK:depleted ˆβdy:109->0 ηey:50->0 ˆθdy:49->0 eηr:39->0; REGRESSION:vocab-recall 0.9685->0.9436 |
| pdf__arxiv__2609.09981.pdf | CHECK:lost-words 15 (baβ bgβ bjβ bln bλβ bμn); CHECK:depleted bjβ:15->0 bgβ:12->0 bλβ:11->0 bωβ:9->0; REGRESSION:recall 0.97->0.9433 |
| pdf__arxiv__2609.10011.pdf | CHECK:lost-words 16 (ap7 ˆbf ˆge ˆgf ˆgs ˆh3); CHECK:depleted ˆgf:5->0 |
| pdf__arxiv__2609.10020.pdf | CHECK:lost-words 19 (bˆε dwˆε wˆε ˆcs ˆqs ˆβ1); CHECK:depleted bˆε:13->0 wˆε:13->0 ˆεt:11->0 ˆcs:10->0 |
| pdf__arxiv__2609.10086.pdf | CHECK:lost-words 8 (viii xii xiii തq0 തq1 തq2); CHECK:depleted eik:20->5 |
| pdf__arxiv__2609.10266.pdf | CHECK:depleted preprint:30->8 review:24->2 iclr:30->8 |
| pdf__arxiv__2609.10291.pdf | CHECK:lost-words 8 (erm ˆin ˆvn ˆαn ˆβn ˆηi); CHECK:depleted ˆθn:49->0 ˆvn:21->0 ˆσn:16->0 ˆηi:8->0 |
| pdf__arxiv__2609.10311.pdf | CHECK:depleted published:26->1 5th:26->1 lifelong:26->1 agents:26->1 |
| pdf__arxiv__2609.10321.pdf | CHECK:depleted submitted:13->2 elsevier:13->2 page:13->2 dargmax:9->0 |
| pdf__arxiv__2609.10371.pdf | CHECK:depleted ˆyi:5->0 |
| pdf__irs__i1040gi.pdf | CHECK:lost-words 5 (ble deduc93 employ12 ment nontaxa92); CHECK:depleted visit:80->11 need:126->58 continued:47->16; REGRESSION:recall 1.0->0.9333 |
| pdf__irs__p15.pdf | CHECK:depleted publication:74->18 |
| pdf__irs__p463.pdf | CHECK:depleted publication:86->32 |
| pdf__irs__p501.pdf | CHECK:depleted publication:44->15 |
| pdf__irs__p505.pdf | CHECK:depleted publication:63->19 chapter:66->28 |
| pdf__irs__p523.pdf | CHECK:depleted publication:37->12 |
| pdf__irs__p525.pdf | CHECK:depleted publication:52->12 |
| pdf__irs__p526.pdf | CHECK:depleted publication:54->16 |
| pdf__irs__p529.pdf | CHECK:depleted publication:26->10 december:18->2 page:18->2 |
| pdf__irs__p550.pdf | CHECK:depleted publication:132->27 trades:103->51; REGRESSION:recall 1.0->0.9567 |
| pdf__irs__p554.pdf | CHECK:depleted publication:47->18 chapter:41->20 |
| pdf__irs__p590a.pdf | CHECK:depleted 590a:64->8 publication:83->28 |
| pdf__irs__p596.pdf | CHECK:depleted publication:54->23 |
| pdf__irs__p970.pdf | CHECK:depleted publication:100->45 |
| pdf__nist__NIST.AI.100-1.pdf | CHECK:depleted nist:76->34 page:48->8 |
| pdf__nist__NIST.CSWP.29.pdf | CHECK:depleted cswp:35->10 framework:49->24 |
| pdf__nist__NIST.FIPS.197-upd1.pdf | CHECK:depleted fips:59->16 |
| pdf__nist__NIST.SP.800-171r3.pdf | CHECK:depleted 800171r3:125->30 protecting:146->51 controlled:147->52 unclassified:133->38 |
| pdf__nist__NIST.SP.800-207.pdf | CHECK:depleted architecture:107->52 |
| pdf__nist__NIST.SP.800-218.pdf | CHECK:depleted version:48->17 |
| pdf__nist__NIST.SP.800-37r2.pdf | CHECK:depleted page:182->30 chapter:102->22 appendix:114->42 three:77->17 |
| pdf__nist__NIST.SP.800-52r2.pdf | CHECK:depleted implementations:102->34 |
| pdf__nist__NIST.SP.800-53r5.pdf | CHECK:lost-words 14 (vii viii wellnist xii xiii xiv); CHECK:depleted rev:526->37 page:475->17 chapter:389->19 three:376->19 |
| pdf__nist__NIST.SP.800-61r3.pdf | CHECK:depleted 80061r3:52->11 april:47->6 cyber:61->20 |
| pdf__nist__NIST.SP.800-63b.pdf | CHECK:depleted digital:114->45 lifecycle:86->17 |
| pdf__nist__NIST.SP.800-88r2.pdf | CHECK:depleted 80088r2:52->13 guidelines:64->25 |
| pdf__nist__NIST.SP.800-90Ar1.pdf | CHECK:depleted rbgs:111->51 rev:109->52 |
| pdf__pdfjs__file_pdfjs_form.pdf | REGRESSION:vocab-recall 1.0->0.875 |
| pdf__slides__european-lisp-symposium_els-web_housel-slides.pdf | CHECK:depleted els:27->3 zürich:27->3 switzerland:27->3 |
| pdf__slides__jeremytammik_tbc_ar20462_angel_velez_ifc_slides.pdf | CHECK:depleted autodesk:149->49; REGRESSION:junk 11.63->12.69 |
| pdf__slides__wzpan_BeamerStyleSlides_slides.pdf | CHECK:depleted josephpan:11->3; CHECK:length 575->345 (no reference) |
| pdf__slides__xiangjjj_implicit_alignment_slides.pdf | CHECK:depleted implicit:61->21 for:60->20 june:44->4 uda:48->8 |
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
| pptx__poi__aascu.org_hbcu_leadershipsummit_cooper_.pptx | REGRESSION:noise 0.0->0.0234 |
| pptx__poi__au.asn.aes.www_conferences_2011_presentations_Fri_20Room4Level4_20930_20Maloney.pptx | improved:untyped->typed |
| pptx__poi__bug54570.pptx | intended:ok->typed-error |
| pptx__poi__bug60715.pptx | intended:ok->typed-error |
| pptx__poi__chart-slide-bg.pptx | intended:ok->typed-error |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-4838644450394112.pptx | improved:untyped->typed |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-5471515212382208.pptx | improved:untyped->typed |
| pptx__poi__clusterfuzz-testcase-minimized-POIXSLFFuzzer-6254434927378432.pptx | improved:untyped->typed |
| pptx__poi__crash-57308ca363f5b71763c489d1b432aff009d4bc4f.pptx | intended:ok->typed-error |
| pptx__poi__layouts.pptx | CHECK:lost-words 5 (apache foundation friday october software); REGRESSION:recall 1.0->0.5; REGRESSION:vocab-recall 1.0->0.8718 |
| pptx__poi__missing-blip-fill.pptx | REGRESSION:ok->error |
| pptx__poi__sample_pptx_grouping_issues.pptx | REGRESSION:ok->error |
| pptx__poi__smartart-rotated-text.pptx | intended:ok->typed-error |
| pptx__poi__table_test2.pptx | REGRESSION:recall 0.8333->0.1667 |
| pptx__unstr__fake-power-point-malformed.pptx | REGRESSION:vocab-recall 1.0->0.4 |
| pptx__unstr__fake-power-point-table.pptx | REGRESSION:recall 1.0->0.0 |
| pptx__unstr__picture.pptx | intended:ok->typed-error |
| pptx__unstr__science-exploration-369p.pptx | CHECK:depleted number:126->36 motivations2007:9->0 |
| pptx__unstr__test-image-jpg-mime.pptx | intended:ok->typed-error |
| txt__gutenberg_cp1252__pg17989.txt | CHECK:depleted mme:235->17 cria:100->16 pense:48->11 clair:34->9 |
| txt__gutenberg_latin1__pg1342.txt | CHECK:depleted bingleys:54->6 bennets:40->10 gardiners:22->9 |
| txt__gutenberg_latin1__pg2600.txt | CHECK:depleted ill:244->57 wont:147->6 emperors:136->33 fathers:101->7 |
| xls__lo__formats.xls | REGRESSION:noise 0.0645->0.1212 |
| xls__lo__forum-fr-59757.xls | REGRESSION:noise 0.0556->0.2273 |
| xls__poi__45672.xls | REGRESSION:recall 1.0->0.0 |
| xls__poi__styles-3563.xls | REGRESSION:recall 0.883->0.7447 |
| xlsb__poi__62815.xlsb | REGRESSION:vocab-recall 0.625->0.375; REGRESSION:noise 0.0->0.4 |
| xlsm__poi__57181.xlsm | REGRESSION:recall 0.9735->0.1534 |
| xlsm__poi__60512.xlsm | REGRESSION:recall 0.975->0.425 |
| xlsm__poi__mv-calculator-final-2-20-2013.xlsm | REGRESSION:recall 1.0->0.3533; REGRESSION:noise 0.0006->0.0231 |
| xlsx__lo__different-column-width-excel2010.xlsx | improved:untyped->typed |
| xlsx__poi__NumberFormatApproxTests.xlsx | CHECK:depleted 2345678e142:11->0 2345678e:10->0; REGRESSION:noise 0.0->0.082 |
| xlsx__poi__clusterfuzz-testcase-minimized-POIXSSFFuzzer-4828727001088000.xlsx | improved:untyped->typed |
| xlsx__poi__clusterfuzz-testcase-minimized-XLSX2CSVFuzzer-5542865479270400.xlsx | improved:untyped->typed |
| xlsx__unstr__2023-half-year-analyses-by-segment.xlsx | REGRESSION:recall 1.0->0.6389 |
| yaml__k8s__application_nginx-app.yaml | improved:error->ok |
| yaml__k8s__application_web_web.yaml | improved:error->ok |
| yaml__k8s__application_wordpress_mysql-deployment.yaml | improved:error->ok |
