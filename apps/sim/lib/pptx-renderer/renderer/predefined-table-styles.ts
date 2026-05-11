/**
 * Predefined (built-in) Office table styles.
 *
 * PowerPoint has 74 predefined table styles that exist natively but are NOT
 * embedded in the PPTX's ppt/tableStyles.xml. Any PPTX can reference them by
 * UUID. This module generates synthetic XML matching the <a:tblStyle> schema
 * so they flow through the existing rendering pipeline unchanged.
 *
 * Derived from LibreOffice's predefined-table-styles.cxx (MPL-2.0) and
 * cross-verified against the Microsoft OOXML predefined style map.
 */

import { parseXml, type SafeXmlNode } from '../parser/xml-parser'

// ---------------------------------------------------------------------------
// UUID → (styleName, accent) map — 74 entries across 11 style groups
// ---------------------------------------------------------------------------

const styleIdMap = new Map<string, [string, string]>([
  // Themed-Style-1
  ['{2D5ABB26-0587-4C30-8999-92F81FD0307C}', ['Themed-Style-1', '']],
  ['{3C2FFA5D-87B4-456A-9821-1D502468CF0F}', ['Themed-Style-1', 'accent1']],
  ['{284E427A-3D55-4303-BF80-6455036E1DE7}', ['Themed-Style-1', 'accent2']],
  ['{69C7853C-536D-4A76-A0AE-DD22124D55A5}', ['Themed-Style-1', 'accent3']],
  ['{775DCB02-9BB8-47FD-8907-85C794F793BA}', ['Themed-Style-1', 'accent4']],
  ['{35758FB7-9AC5-4552-8A53-C91805E547FA}', ['Themed-Style-1', 'accent5']],
  ['{08FB837D-C827-4EFA-A057-4D05807E0F7C}', ['Themed-Style-1', 'accent6']],

  // Themed-Style-2
  ['{5940675A-B579-460E-94D1-54222C63F5DA}', ['Themed-Style-2', '']],
  ['{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}', ['Themed-Style-2', 'accent1']],
  ['{18603FDC-E32A-4AB5-989C-0864C3EAD2B8}', ['Themed-Style-2', 'accent2']],
  ['{306799F8-075E-4A3A-A7F6-7FBC6576F1A4}', ['Themed-Style-2', 'accent3']],
  ['{E269D01E-BC32-4049-B463-5C60D7B0CCD2}', ['Themed-Style-2', 'accent4']],
  ['{327F97BB-C833-4FB7-BDE5-3F7075034690}', ['Themed-Style-2', 'accent5']],
  ['{638B1855-1B75-4FBE-930C-398BA8C253C6}', ['Themed-Style-2', 'accent6']],

  // Light-Style-1
  ['{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}', ['Light-Style-1', '']],
  ['{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}', ['Light-Style-1', 'accent1']],
  ['{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}', ['Light-Style-1', 'accent2']],
  ['{C083E6E3-FA7D-4D7B-A595-EF9225AFEA82}', ['Light-Style-1', 'accent3']],
  ['{D27102A9-8310-4765-A935-A1911B00CA55}', ['Light-Style-1', 'accent4']],
  ['{5FD0F851-EC5A-4D38-B0AD-8093EC10F338}', ['Light-Style-1', 'accent5']],
  ['{68D230F3-CF80-4859-8CE7-A43EE81993B5}', ['Light-Style-1', 'accent6']],

  // Light-Style-2
  ['{7E9639D4-E3E2-4D34-9284-5A2195B3D0D7}', ['Light-Style-2', '']],
  ['{69012ECD-51FC-41F1-AA8D-1B2483CD663E}', ['Light-Style-2', 'accent1']],
  ['{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}', ['Light-Style-2', 'accent2']],
  ['{F2DE63D5-997A-4646-A377-4702673A728D}', ['Light-Style-2', 'accent3']],
  ['{17292A2E-F333-43FB-9621-5CBBE7FDCDCB}', ['Light-Style-2', 'accent4']],
  ['{5A111915-BE36-4E01-A7E5-04B1672EAD32}', ['Light-Style-2', 'accent5']],
  ['{912C8C85-51F0-491E-9774-3900AFEF0FD7}', ['Light-Style-2', 'accent6']],

  // Light-Style-3
  ['{616DA210-FB5B-4158-B5E0-FEB733F419BA}', ['Light-Style-3', '']],
  ['{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}', ['Light-Style-3', 'accent1']],
  ['{5DA37D80-6434-44D0-A028-1B22A696006F}', ['Light-Style-3', 'accent2']],
  ['{8799B23B-EC83-4686-B30A-512413B5E67A}', ['Light-Style-3', 'accent3']],
  ['{ED083AE6-46FA-4A59-8FB0-9F97EB10719F}', ['Light-Style-3', 'accent4']],
  ['{BDBED569-4797-4DF1-A0F4-6AAB3CD982D8}', ['Light-Style-3', 'accent5']],
  ['{E8B1032C-EA38-4F05-BA0D-38AFFFC7BED3}', ['Light-Style-3', 'accent6']],

  // Medium-Style-1
  ['{793D81CF-94F2-401A-BA57-92F5A7B2D0C5}', ['Medium-Style-1', '']],
  ['{B301B821-A1FF-4177-AEE7-76D212191A09}', ['Medium-Style-1', 'accent1']],
  ['{9DCAF9ED-07DC-4A11-8D7F-57B35C25682E}', ['Medium-Style-1', 'accent2']],
  ['{1FECB4D8-DB02-4DC6-A0A2-4F2EBAE1DC90}', ['Medium-Style-1', 'accent3']],
  ['{1E171933-4619-4E11-9A3F-F7608DF75F80}', ['Medium-Style-1', 'accent4']],
  ['{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}', ['Medium-Style-1', 'accent5']],
  ['{10A1B5D5-9B99-4C35-A422-299274C87663}', ['Medium-Style-1', 'accent6']],

  // Medium-Style-2
  ['{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}', ['Medium-Style-2', '']],
  ['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', ['Medium-Style-2', 'accent1']],
  ['{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', ['Medium-Style-2', 'accent2']],
  ['{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', ['Medium-Style-2', 'accent3']],
  ['{00A15C55-8517-42AA-B614-E9B94910E393}', ['Medium-Style-2', 'accent4']],
  ['{7DF18680-E054-41AD-8BC1-D1AEF772440D}', ['Medium-Style-2', 'accent5']],
  ['{93296810-A885-4BE3-A3E7-6D5BEEA58F35}', ['Medium-Style-2', 'accent6']],

  // Medium-Style-3
  ['{8EC20E35-A176-4012-BC5E-935CFFF8708E}', ['Medium-Style-3', '']],
  ['{6E25E649-3F16-4E02-A733-19D2CDBF48F0}', ['Medium-Style-3', 'accent1']],
  ['{85BE263C-DBD7-4A20-BB59-AAB30ACAA65A}', ['Medium-Style-3', 'accent2']],
  ['{EB344D84-9AFB-497E-A393-DC336BA19D2E}', ['Medium-Style-3', 'accent3']],
  ['{EB9631B5-78F2-41C9-869B-9F39066F8104}', ['Medium-Style-3', 'accent4']],
  ['{74C1A8A3-306A-4EB7-A6B1-4F7E0EB9C5D6}', ['Medium-Style-3', 'accent5']],
  ['{2A488322-F2BA-4B5B-9748-0D474271808F}', ['Medium-Style-3', 'accent6']],

  // Medium-Style-4
  ['{D7AC3CCA-C797-4891-BE02-D94E43425B78}', ['Medium-Style-4', '']],
  ['{69CF1AB2-1976-4502-BF36-3FF5EA218861}', ['Medium-Style-4', 'accent1']],
  ['{8A107856-5554-42FB-B03E-39F5DBC370BA}', ['Medium-Style-4', 'accent2']],
  ['{0505E3EF-67EA-436B-97B2-0124C06EBD24}', ['Medium-Style-4', 'accent3']],
  ['{C4B1156A-380E-4F78-BDF5-A606A8083BF9}', ['Medium-Style-4', 'accent4']],
  ['{22838BEF-8BB2-4498-84A7-C5851F593DF1}', ['Medium-Style-4', 'accent5']],
  ['{16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4}', ['Medium-Style-4', 'accent6']],

  // Dark-Style-1
  ['{E8034E78-7F5D-4C2E-B375-FC64B27BC917}', ['Dark-Style-1', '']],
  ['{125E5076-3810-47DD-B79F-674D7AD40C01}', ['Dark-Style-1', 'accent1']],
  ['{37CE84F3-28C3-443E-9E96-99CF82512B78}', ['Dark-Style-1', 'accent2']],
  ['{D03447BB-5D67-496B-8E87-E561075AD55C}', ['Dark-Style-1', 'accent3']],
  ['{E929F9F4-4A8F-4326-A1B4-22849713DDAB}', ['Dark-Style-1', 'accent4']],
  ['{8FD4443E-F989-4FC4-A0C8-D5A2AF1F390B}', ['Dark-Style-1', 'accent5']],
  ['{AF606853-7671-496A-8E4F-DF71F8EC918B}', ['Dark-Style-1', 'accent6']],

  // Dark-Style-2 (only 4 variants)
  ['{5202B0CA-FC54-4496-8BCA-5EF66A818D29}', ['Dark-Style-2', '']],
  ['{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}', ['Dark-Style-2', 'accent1']],
  ['{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}', ['Dark-Style-2', 'accent3']],
  ['{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}', ['Dark-Style-2', 'accent5']],
])

// ---------------------------------------------------------------------------
// XML helpers — reduce boilerplate in style generators
// ---------------------------------------------------------------------------

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

/** Solid fill with a scheme color and optional transform */
function fillSolid(scheme: string, transform?: string): string {
  const mod = transform ? `<a:${transform}/>` : ''
  return `<a:fill><a:solidFill><a:schemeClr val="${scheme}">${mod}</a:schemeClr></a:solidFill></a:fill>`
}

/** A border <a:ln> element with scheme color */
function borderLn(scheme: string, transform?: string): string {
  const mod = transform ? `<a:${transform}/>` : ''
  return `<a:ln w="12700"><a:solidFill><a:schemeClr val="${scheme}">${mod}</a:schemeClr></a:solidFill></a:ln>`
}

/** Text color element within tcTxStyle */
function tcTxStyle(scheme: string, bold?: boolean): string {
  const bAttr = bold ? ' b="on"' : ''
  const colorEl = scheme ? `<a:schemeClr val="${scheme}"/>` : ''
  return `<a:tcTxStyle${bAttr}>${colorEl}</a:tcTxStyle>`
}

/** Style part with optional fill, borders, and text style */
function stylePart(
  tag: string,
  opts: {
    textColor?: string
    bold?: boolean
    fill?: string
    borders?: Record<string, string>
  }
): string {
  if (!opts.textColor && !opts.bold && !opts.fill && !opts.borders) return ''
  const parts: string[] = [`<a:${tag}>`]
  if (opts.textColor || opts.bold) parts.push(tcTxStyle(opts.textColor ?? '', opts.bold))
  parts.push('<a:tcStyle>')
  if (opts.fill) parts.push(opts.fill)
  if (opts.borders) {
    parts.push('<a:tcBdr>')
    for (const [side, ln] of Object.entries(opts.borders)) {
      parts.push(`<a:${side}>${ln}</a:${side}>`)
    }
    parts.push('</a:tcBdr>')
  }
  parts.push('</a:tcStyle>')
  parts.push(`</a:${tag}>`)
  return parts.join('')
}

// ---------------------------------------------------------------------------
// Style group XML generators
// ---------------------------------------------------------------------------

function themedStyle1(accent: string, styleId: string): string {
  const hasAccent = accent !== ''
  const accentVal = hasAccent ? accent : 'tx1'
  const parts: string[] = []

  if (hasAccent) {
    // wholeTbl: text=dk1, borders=accent on all sides
    const allBorders: Record<string, string> = {
      left: borderLn(accentVal),
      right: borderLn(accentVal),
      top: borderLn(accentVal),
      bottom: borderLn(accentVal),
      insideH: borderLn(accentVal),
      insideV: borderLn(accentVal),
    }
    parts.push(stylePart('wholeTbl', { textColor: 'dk1', borders: allBorders }))

    // band1H/V: accent + alpha(40000)
    const bandFill = fillSolid(accentVal, `alpha val="40000"`)
    parts.push(stylePart('band1H', { fill: bandFill }))
    parts.push(stylePart('band1V', { fill: bandFill }))

    // firstRow: text=lt1, bold, fill=accent, borders=accent (+ bottom=lt1)
    parts.push(
      stylePart('firstRow', {
        textColor: 'lt1',
        bold: true,
        fill: fillSolid(accentVal),
        borders: {
          left: borderLn(accentVal),
          right: borderLn(accentVal),
          top: borderLn(accentVal),
          bottom: borderLn('lt1'),
        },
      })
    )

    // lastRow: bold, borders=accent
    parts.push(
      stylePart('lastRow', {
        bold: true,
        borders: {
          left: borderLn(accentVal),
          right: borderLn(accentVal),
          top: borderLn(accentVal),
          bottom: borderLn(accentVal),
        },
      })
    )

    // firstCol/lastCol: bold, borders=accent (+ insideH)
    const colBorders: Record<string, string> = {
      left: borderLn(accentVal),
      right: borderLn(accentVal),
      top: borderLn(accentVal),
      bottom: borderLn(accentVal),
      insideH: borderLn(accentVal),
    }
    parts.push(stylePart('firstCol', { bold: true, borders: colBorders }))
    parts.push(stylePart('lastCol', { bold: true, borders: colBorders }))
  } else {
    // No accent: text=tx1, band with alpha
    parts.push(stylePart('wholeTbl', { textColor: 'tx1' }))
    const bandFill = fillSolid('tx1', `alpha val="40000"`)
    parts.push(stylePart('band1H', { fill: bandFill }))
    parts.push(stylePart('band1V', { fill: bandFill }))
  }

  return wrapTblStyle(styleId, 'Themed-Style-1', parts.join(''))
}

function themedStyle2(accent: string, styleId: string): string {
  const hasAccent = accent !== ''
  const parts: string[] = []

  if (hasAccent) {
    const accentVal = accent
    // tblBg: accent fill
    const tblBg = `<a:tblBg><a:fillRef idx="1"><a:schemeClr val="${accentVal}"/></a:fillRef></a:tblBg>`

    // wholeTbl: text=lt1, outer borders=accent+tint(50000)
    const outerBorders: Record<string, string> = {
      left: borderLn(accentVal, `tint val="50000"`),
      right: borderLn(accentVal, `tint val="50000"`),
      top: borderLn(accentVal, `tint val="50000"`),
      bottom: borderLn(accentVal, `tint val="50000"`),
    }
    parts.push(stylePart('wholeTbl', { textColor: 'lt1', borders: outerBorders }))

    // band1H/V: lt1 + alpha(20000)
    const bandFill = fillSolid('lt1', `alpha val="20000"`)
    parts.push(stylePart('band1H', { fill: bandFill }))
    parts.push(stylePart('band1V', { fill: bandFill }))

    // firstRow: text=lt1, bold, bottom border=lt1
    parts.push(
      stylePart('firstRow', { textColor: 'lt1', bold: true, borders: { bottom: borderLn('lt1') } })
    )
    // lastRow: bold, top border=lt1
    parts.push(stylePart('lastRow', { bold: true, borders: { top: borderLn('lt1') } }))
    // firstCol: bold, right border=lt1
    parts.push(stylePart('firstCol', { bold: true, borders: { right: borderLn('lt1') } }))
    // lastCol: bold, left border=lt1
    parts.push(stylePart('lastCol', { bold: true, borders: { left: borderLn('lt1') } }))

    return wrapTblStyle(styleId, 'Themed-Style-2', tblBg + parts.join(''))
  }
  // No accent: text=tx1 (implicit), outer borders=tx1+tint(50000), inside borders=tx1
  const outerBorders: Record<string, string> = {
    left: borderLn('tx1', `tint val="50000"`),
    right: borderLn('tx1', `tint val="50000"`),
    top: borderLn('tx1', `tint val="50000"`),
    bottom: borderLn('tx1', `tint val="50000"`),
    insideH: borderLn('tx1'),
    insideV: borderLn('tx1'),
  }
  parts.push(stylePart('wholeTbl', { borders: outerBorders }))

  const bandFill = fillSolid('tx1', `alpha val="20000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  return wrapTblStyle(styleId, 'Themed-Style-2', parts.join(''))
}

function lightStyle1(accent: string, styleId: string): string {
  const accentVal = accent || 'tx1'
  const parts: string[] = []

  // wholeTbl: text=tx1, top/bottom borders
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'tx1',
      borders: {
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
      },
    })
  )

  // band1H/V: accent + alpha(20000)
  const bandFill = fillSolid(accentVal, `alpha val="20000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=tx1, bold, bottom border
  parts.push(
    stylePart('firstRow', {
      textColor: 'tx1',
      bold: true,
      borders: { bottom: borderLn(accentVal) },
    })
  )

  // lastRow: bold, top border
  parts.push(stylePart('lastRow', { bold: true, borders: { top: borderLn(accentVal) } }))

  // firstCol: bold text
  parts.push(stylePart('firstCol', { textColor: 'tx1', bold: true }))
  // lastCol: bold text
  parts.push(stylePart('lastCol', { textColor: 'tx1', bold: true }))

  return wrapTblStyle(styleId, 'Light-Style-1', parts.join(''))
}

function lightStyle2(accent: string, styleId: string): string {
  const accentVal = accent || 'tx1'
  const parts: string[] = []

  // wholeTbl: text=tx1, all 4 outer borders
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'tx1',
      borders: {
        left: borderLn(accentVal),
        right: borderLn(accentVal),
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
      },
    })
  )

  // band1H: top+bottom borders
  parts.push(
    stylePart('band1H', {
      borders: {
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
      },
    })
  )

  // band1V/band2V: left+right borders
  parts.push(
    stylePart('band1V', {
      borders: { left: borderLn(accentVal), right: borderLn(accentVal) },
    })
  )
  parts.push(
    stylePart('band2V', {
      borders: { left: borderLn(accentVal), right: borderLn(accentVal) },
    })
  )

  // firstRow: text=bg1, bold, fill=accent
  parts.push(stylePart('firstRow', { textColor: 'bg1', bold: true, fill: fillSolid(accentVal) }))

  // lastRow: bold, top border
  parts.push(stylePart('lastRow', { bold: true, borders: { top: borderLn(accentVal) } }))

  // firstCol: bold
  parts.push(stylePart('firstCol', { bold: true }))
  // lastCol: bold
  parts.push(stylePart('lastCol', { bold: true }))

  return wrapTblStyle(styleId, 'Light-Style-2', parts.join(''))
}

function lightStyle3(accent: string, styleId: string): string {
  const accentVal = accent || 'tx1'
  const parts: string[] = []

  // wholeTbl: text=tx1, all 6 borders
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'tx1',
      borders: {
        left: borderLn(accentVal),
        right: borderLn(accentVal),
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
        insideH: borderLn(accentVal),
        insideV: borderLn(accentVal),
      },
    })
  )

  // band1H/V: accent + alpha(20000)
  const bandFill = fillSolid(accentVal, `alpha val="20000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=accent, bold, bottom border
  parts.push(
    stylePart('firstRow', {
      textColor: accentVal,
      bold: true,
      borders: { bottom: borderLn(accentVal) },
    })
  )

  // lastRow: bold, top border
  parts.push(stylePart('lastRow', { bold: true, borders: { top: borderLn(accentVal) } }))

  // firstCol: bold
  parts.push(stylePart('firstCol', { bold: true }))
  // lastCol: bold
  parts.push(stylePart('lastCol', { bold: true }))

  return wrapTblStyle(styleId, 'Light-Style-3', parts.join(''))
}

function mediumStyle1(accent: string, styleId: string): string {
  const accentVal = accent || 'dk1'
  const parts: string[] = []

  // wholeTbl: text=dk1, fill=lt1, borders (left/right/top/bottom/insideH)
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid('lt1'),
      borders: {
        left: borderLn(accentVal),
        right: borderLn(accentVal),
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
        insideH: borderLn(accentVal),
      },
    })
  )

  // band1H/V: accent + tint(20000)
  const bandFill = fillSolid(accentVal, `tint val="20000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=lt1, bold, fill=accent
  parts.push(stylePart('firstRow', { textColor: 'lt1', bold: true, fill: fillSolid(accentVal) }))

  // lastRow: bold, fill=lt1, top border
  parts.push(
    stylePart('lastRow', {
      bold: true,
      fill: fillSolid('lt1'),
      borders: { top: borderLn(accentVal) },
    })
  )

  // firstCol: bold
  parts.push(stylePart('firstCol', { bold: true }))
  // lastCol: bold
  parts.push(stylePart('lastCol', { bold: true }))

  return wrapTblStyle(styleId, 'Medium-Style-1', parts.join(''))
}

function mediumStyle2(accent: string, styleId: string): string {
  const accentVal = accent || 'dk1'
  const parts: string[] = []

  // wholeTbl: text=dk1, fill=accent+tint(20000), all borders=lt1
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid(accentVal, `tint val="20000"`),
      borders: {
        left: borderLn('lt1'),
        right: borderLn('lt1'),
        top: borderLn('lt1'),
        bottom: borderLn('lt1'),
        insideH: borderLn('lt1'),
        insideV: borderLn('lt1'),
      },
    })
  )

  // band1H/V: accent + tint(40000)
  const bandFill = fillSolid(accentVal, `tint val="40000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=lt1, bold, fill=accent, bottom border=lt1
  parts.push(
    stylePart('firstRow', {
      textColor: 'lt1',
      bold: true,
      fill: fillSolid(accentVal),
      borders: { bottom: borderLn('lt1') },
    })
  )

  // lastRow: text=lt1, bold, fill=accent, top border=lt1
  parts.push(
    stylePart('lastRow', {
      textColor: 'lt1',
      bold: true,
      fill: fillSolid(accentVal),
      borders: { top: borderLn('lt1') },
    })
  )

  // firstCol: text=lt1, bold, fill=accent
  parts.push(stylePart('firstCol', { textColor: 'lt1', bold: true, fill: fillSolid(accentVal) }))

  // lastCol: text=lt1, bold, fill=accent
  parts.push(stylePart('lastCol', { textColor: 'lt1', bold: true, fill: fillSolid(accentVal) }))

  return wrapTblStyle(styleId, 'Medium-Style-2', parts.join(''))
}

function mediumStyle3(accent: string, styleId: string): string {
  const accentVal = accent || 'dk1'
  const parts: string[] = []

  // wholeTbl: text=dk1, fill=lt1, top/bottom borders=dk1
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid('lt1'),
      borders: {
        top: borderLn('dk1'),
        bottom: borderLn('dk1'),
      },
    })
  )

  // band1H/V: dk1 + tint(20000)
  const bandFill = fillSolid('dk1', `tint val="20000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=lt1, bold, fill=accent, bottom border=dk1
  parts.push(
    stylePart('firstRow', {
      textColor: 'lt1',
      bold: true,
      fill: fillSolid(accentVal),
      borders: { bottom: borderLn('dk1') },
    })
  )

  // lastRow: bold, fill=lt1, top border=dk1
  parts.push(
    stylePart('lastRow', {
      bold: true,
      fill: fillSolid('lt1'),
      borders: { top: borderLn('dk1') },
    })
  )

  // firstCol: text=lt1, bold, fill=accent
  parts.push(stylePart('firstCol', { textColor: 'lt1', bold: true, fill: fillSolid(accentVal) }))

  // lastCol: text=lt1, bold, fill=accent
  parts.push(stylePart('lastCol', { textColor: 'lt1', bold: true, fill: fillSolid(accentVal) }))

  return wrapTblStyle(styleId, 'Medium-Style-3', parts.join(''))
}

function mediumStyle4(accent: string, styleId: string): string {
  const accentVal = accent || 'dk1'
  const parts: string[] = []

  // wholeTbl: text=dk1, fill=accent+tint(20000), all 6 borders=accent
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid(accentVal, `tint val="20000"`),
      borders: {
        left: borderLn(accentVal),
        right: borderLn(accentVal),
        top: borderLn(accentVal),
        bottom: borderLn(accentVal),
        insideH: borderLn(accentVal),
        insideV: borderLn(accentVal),
      },
    })
  )

  // band1H/V: accent + tint(40000)
  const bandFill = fillSolid(accentVal, `tint val="40000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=accent, bold, fill=accent+tint(20000)
  parts.push(
    stylePart('firstRow', {
      textColor: accentVal,
      bold: true,
      fill: fillSolid(accentVal, `tint val="20000"`),
    })
  )

  // lastRow: bold, fill=dk1+tint(20000), top border=dk1
  parts.push(
    stylePart('lastRow', {
      bold: true,
      fill: fillSolid('dk1', `tint val="20000"`),
      borders: { top: borderLn('dk1') },
    })
  )

  // firstCol: bold
  parts.push(stylePart('firstCol', { bold: true }))
  // lastCol: bold
  parts.push(stylePart('lastCol', { bold: true }))

  return wrapTblStyle(styleId, 'Medium-Style-4', parts.join(''))
}

function darkStyle1(accent: string, styleId: string): string {
  const hasAccent = accent !== ''
  const accentVal = hasAccent ? accent : 'dk1'
  const transformType = hasAccent ? 'shade' : 'tint'
  const parts: string[] = []

  // wholeTbl: text=dk1, fill=accent+shade/tint(20000)
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid(accentVal, `${transformType} val="20000"`),
    })
  )

  // band1H/V: accent + shade/tint(40000)
  const bandFill = fillSolid(accentVal, `${transformType} val="40000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=lt1, bold, fill=dk1, bottom border=lt1
  parts.push(
    stylePart('firstRow', {
      textColor: 'lt1',
      bold: true,
      fill: fillSolid('dk1'),
      borders: { bottom: borderLn('lt1') },
    })
  )

  // lastRow: bold, fill=accent+shade/tint(20000), top border=lt1
  parts.push(
    stylePart('lastRow', {
      bold: true,
      fill: fillSolid(accentVal),
      borders: { top: borderLn('lt1') },
    })
  )

  // firstCol: bold, fill=accent+shade/tint(60000), right border=lt1
  parts.push(
    stylePart('firstCol', {
      bold: true,
      fill: fillSolid(accentVal, `${transformType} val="60000"`),
      borders: { right: borderLn('lt1') },
    })
  )

  // lastCol: bold, fill=accent+shade/tint(60000), left border=lt1
  parts.push(
    stylePart('lastCol', {
      bold: true,
      fill: fillSolid(accentVal, `${transformType} val="60000"`),
      borders: { left: borderLn('lt1') },
    })
  )

  return wrapTblStyle(styleId, 'Dark-Style-1', parts.join(''))
}

function darkStyle2(accent: string, styleId: string): string {
  const accentVal = accent || 'dk1'
  const parts: string[] = []

  // Determine firstRow fill: accent-shift logic
  let firstRowFillColor: string
  if (accent === '') firstRowFillColor = 'dk1'
  else if (accent === 'accent1') firstRowFillColor = 'accent2'
  else if (accent === 'accent3') firstRowFillColor = 'accent4'
  else if (accent === 'accent5') firstRowFillColor = 'accent6'
  else firstRowFillColor = accentVal

  // wholeTbl: text=dk1, fill=accent+tint(20000)
  parts.push(
    stylePart('wholeTbl', {
      textColor: 'dk1',
      fill: fillSolid(accentVal, `tint val="20000"`),
    })
  )

  // band1H/V: accent + tint(40000)
  const bandFill = fillSolid(accentVal, `tint val="40000"`)
  parts.push(stylePart('band1H', { fill: bandFill }))
  parts.push(stylePart('band1V', { fill: bandFill }))

  // firstRow: text=lt1, bold, fill=firstRowFillColor
  parts.push(
    stylePart('firstRow', {
      textColor: 'lt1',
      bold: true,
      fill: fillSolid(firstRowFillColor),
    })
  )

  // lastRow: bold, fill=accent+tint(20000), top border=dk1
  parts.push(
    stylePart('lastRow', {
      bold: true,
      fill: fillSolid(accentVal, `tint val="20000"`),
      borders: { top: borderLn('dk1') },
    })
  )

  // firstCol: bold
  parts.push(stylePart('firstCol', { bold: true }))
  // lastCol: bold
  parts.push(stylePart('lastCol', { bold: true }))

  return wrapTblStyle(styleId, 'Dark-Style-2', parts.join(''))
}

// ---------------------------------------------------------------------------
// XML wrapper
// ---------------------------------------------------------------------------

function wrapTblStyle(styleId: string, styleName: string, innerXml: string): string {
  return `<a:tblStyle ${NS} styleId="${styleId}" styleName="${styleName}">${innerXml}</a:tblStyle>`
}

// ---------------------------------------------------------------------------
// Style generator dispatch
// ---------------------------------------------------------------------------

const styleGenerators: Record<string, (accent: string, styleId: string) => string> = {
  'Themed-Style-1': themedStyle1,
  'Themed-Style-2': themedStyle2,
  'Light-Style-1': lightStyle1,
  'Light-Style-2': lightStyle2,
  'Light-Style-3': lightStyle3,
  'Medium-Style-1': mediumStyle1,
  'Medium-Style-2': mediumStyle2,
  'Medium-Style-3': mediumStyle3,
  'Medium-Style-4': mediumStyle4,
  'Dark-Style-1': darkStyle1,
  'Dark-Style-2': darkStyle2,
}

// ---------------------------------------------------------------------------
// Module-level cache & public API
// ---------------------------------------------------------------------------

const cache = new Map<string, SafeXmlNode>()

/**
 * Get a predefined table style by its UUID.
 * Returns the parsed SafeXmlNode (a:tblStyle element) or undefined if not a known predefined style.
 * Results are cached — same UUID always returns the same instance.
 */
export function getPredefinedTableStyle(styleId: string): SafeXmlNode | undefined {
  const cached = cache.get(styleId)
  if (cached) return cached

  const entry = styleIdMap.get(styleId)
  if (!entry) return undefined

  const [styleName, accent] = entry
  const generator = styleGenerators[styleName]
  if (!generator) return undefined

  const xml = generator(accent, styleId)
  const node = parseXml(xml)
  if (!node.exists()) return undefined

  cache.set(styleId, node)
  return node
}

/** Exported for testing: number of known predefined style UUIDs. */
export const PREDEFINED_STYLE_COUNT = styleIdMap.size

/** Exported for testing: all known style IDs. */
export function getAllPredefinedStyleIds(): string[] {
  return Array.from(styleIdMap.keys())
}
