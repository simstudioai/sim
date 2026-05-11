/**
 * Table renderer — converts TableNodeData into positioned HTML table elements.
 *
 * Table style behavior follows:
 * - OOXML ECMA-376 §21.1.3.15 tblPr: firstRow, firstCol, bandRow, bandCol, lastRow, lastCol
 *   are attributes; when not specified they default to off (no styling).
 * - references/pptxjs (gen-table.ts, get-table-row-style.ts, get-table-cell-params.ts):
 *   reads tblPr attrs only (e.g. firstCol === "1"), applies style parts when attr is "1",
 *   and uses tcTxStyle from each part for cell text color/font (a:tcTxStyle under firstRow, firstCol, etc.).
 */

import type { TableCell, TableNodeData } from '../model/nodes/table-node'
import { emuToPx } from '../parser/units'
import type { SafeXmlNode } from '../parser/xml-parser'
import { hexToRgb } from '../utils/color'
import { getPredefinedTableStyle } from './predefined-table-styles'
import type { RenderContext } from './render-context'
import { resolveColor, resolveLineStyle } from './style-resolver'
import { renderTextBody } from './text-renderer'

// ---------------------------------------------------------------------------
// Table Style Lookup
// ---------------------------------------------------------------------------

/**
 * Find a table style node by its ID from presentation.tableStyles.
 * tableStyles XML structure: <a:tblStyleLst> <a:tblStyle styleId="{UUID}" ...>
 */
function findTableStyle(
  tableStyleId: string | undefined,
  ctx: RenderContext
): SafeXmlNode | undefined {
  if (!tableStyleId || !ctx.presentation.tableStyles) return undefined
  const tblStyleLst = ctx.presentation.tableStyles
  for (const style of tblStyleLst.children('tblStyle')) {
    if (style.attr('styleId') === tableStyleId) {
      return style
    }
  }
  // Also check from root if tableStyles IS the tblStyleLst
  for (const style of tblStyleLst.children()) {
    if (style.localName === 'tblStyle' && style.attr('styleId') === tableStyleId) {
      return style
    }
  }
  // Fallback: check predefined (built-in) Office table styles not embedded in the PPTX
  return getPredefinedTableStyle(tableStyleId)
}

/**
 * Get the appropriate style section from a table style for a given cell position.
 * Priority: specific section > wholeTbl (fallback).
 */
function getStyleSections(
  tblStyle: SafeXmlNode,
  rowIdx: number,
  colIdx: number,
  totalRows: number,
  totalCols: number,
  tblPr: SafeXmlNode | undefined
): SafeXmlNode[] {
  const sections: SafeXmlNode[] = []

  // Style parts enabled only when tblPr has attribute "1" (or true); per spec default is off.
  // pptxjs uses attrs only (firstCol === "1"); we also accept child elements for compatibility.
  const flag = (attrName: string, childName: string): boolean => {
    if (!tblPr) return false
    const attr = tblPr.attr(attrName)
    if (attr !== undefined) return attr === '1' || attr === 'true'
    const ch = tblPr.child(childName)
    if (ch.exists()) {
      const val = ch.attr('val')
      return val !== '0' && val !== 'false'
    }
    return false
  }
  const bandRow =
    tblPr?.attr('bandRow') === '1' ||
    tblPr?.attr('bandRow') === 'true' ||
    tblPr?.child('bandRow').exists()
  const bandCol =
    tblPr?.attr('bandCol') === '1' ||
    tblPr?.attr('bandCol') === 'true' ||
    tblPr?.child('bandCol').exists()
  const isFirstRow = flag('firstRow', 'firstRow')
  const isLastRow = flag('lastRow', 'lastRow')
  const isFirstCol = flag('firstCol', 'firstCol')
  const isLastCol = flag('lastCol', 'lastCol')

  // wholeTbl is the base (lowest priority)
  const wholeTbl = tblStyle.child('wholeTbl')
  if (wholeTbl.exists()) sections.push(wholeTbl)

  // Banding (applied on top of wholeTbl)
  if (bandRow) {
    const effectiveRow = isFirstRow ? rowIdx - 1 : rowIdx
    if (effectiveRow >= 0 && effectiveRow % 2 === 1) {
      const band = tblStyle.child('band2H')
      if (band.exists()) sections.push(band)
    } else if (effectiveRow >= 0 && effectiveRow % 2 === 0) {
      const band = tblStyle.child('band1H')
      if (band.exists()) sections.push(band)
    }
  }

  if (bandCol) {
    if (colIdx % 2 === 1) {
      const band = tblStyle.child('band2V')
      if (band.exists()) sections.push(band)
    } else {
      const band = tblStyle.child('band1V')
      if (band.exists()) sections.push(band)
    }
  }

  // Special rows/cols (highest priority, override banding)
  if (isFirstRow && rowIdx === 0) {
    const s = tblStyle.child('firstRow')
    if (s.exists()) sections.push(s)
  }
  if (isLastRow && rowIdx === totalRows - 1) {
    const s = tblStyle.child('lastRow')
    if (s.exists()) sections.push(s)
  }
  if (isFirstCol && colIdx === 0) {
    const s = tblStyle.child('firstCol')
    if (s.exists()) sections.push(s)
  }
  if (isLastCol && colIdx === totalCols - 1) {
    const s = tblStyle.child('lastCol')
    if (s.exists()) sections.push(s)
  }

  return sections
}

/** Resolved text properties from table style tcTxStyle. */
interface TableStyleTextProps {
  color?: string
  bold?: boolean
  italic?: boolean
  fontFamily?: string
}

/**
 * Get the effective text properties from table style sections (last section with tcTxStyle wins).
 * tcTxStyle supports: b (bold), i (italic), and color children (schemeClr, solidFill, etc.).
 * When a style part (e.g. firstCol, firstRow) is applied, we use that part's tcTxStyle for cell
 * text styling so text stays readable on styled fill.
 */
function getEffectiveTableStyleTextProps(
  sections: SafeXmlNode[],
  ctx: RenderContext
): TableStyleTextProps | undefined {
  for (let i = sections.length - 1; i >= 0; i--) {
    const tcTxStyle = sections[i].child('tcTxStyle')
    if (!tcTxStyle.exists()) continue

    const props: TableStyleTextProps = {}

    // Bold: b="on" or b="off" (OOXML CT_TableStyleTextStyle)
    const b = tcTxStyle.attr('b')
    if (b === 'on') props.bold = true
    else if (b === 'off') props.bold = false

    // Italic: i="on" or i="off"
    const italic = tcTxStyle.attr('i')
    if (italic === 'on') props.italic = true
    else if (italic === 'off') props.italic = false

    // Color: child elements (schemeClr, solidFill, srgbClr, etc.)
    for (const child of tcTxStyle.allChildren()) {
      const tag = child.localName
      if (
        tag === 'schemeClr' ||
        tag === 'solidFill' ||
        tag === 'srgbClr' ||
        tag === 'scrgbClr' ||
        tag === 'prstClr' ||
        tag === 'sysClr'
      ) {
        const { color, alpha } = resolveColor(child, ctx)
        const hex = color.startsWith('#') ? color : `#${color}`
        if (alpha < 1) {
          const { r, g, b: bl } = hexToRgb(hex)
          props.color = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`
        } else {
          props.color = hex
        }
        break
      }
    }

    // Font family: <font><latin>/<ea>/<cs> typeface or <fontRef idx="major|minor">
    const font = tcTxStyle.child('font')
    if (font.exists()) {
      const latin = font.child('latin').attr('typeface')
      const ea = font.child('ea').attr('typeface')
      const cs = font.child('cs').attr('typeface')
      props.fontFamily = latin || ea || cs
    }
    if (!props.fontFamily) {
      const fontRef = tcTxStyle.child('fontRef')
      if (fontRef.exists()) {
        const idx = fontRef.attr('idx')
        if (idx === 'major') {
          props.fontFamily = ctx.theme.majorFont.latin || ctx.theme.majorFont.ea
        } else if (idx === 'minor') {
          props.fontFamily = ctx.theme.minorFont.latin || ctx.theme.minorFont.ea
        }
      }
    }

    return props
  }
  return undefined
}

/**
 * Apply fill from a table style tcStyle node.
 * Structure: <a:tcStyle> <a:fill> <a:solidFill>... or <a:fillRef>...
 */
function applyStyleFill(td: HTMLElement, tcStyle: SafeXmlNode, ctx: RenderContext): boolean {
  const fill = tcStyle.child('fill')
  if (!fill.exists()) return false

  // solidFill
  const solidFill = fill.child('solidFill')
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      td.style.backgroundColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    } else {
      td.style.backgroundColor = hex
    }
    return true
  }

  // fillRef (theme fill reference)
  const fillRef = fill.child('fillRef')
  if (fillRef.exists()) {
    // fillRef contains a color child + idx attribute
    const { color, alpha } = resolveColor(fillRef, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      td.style.backgroundColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    } else {
      td.style.backgroundColor = hex
    }
    return true
  }

  // noFill
  const noFill = fill.child('noFill')
  if (noFill.exists()) return true // explicitly no fill

  return false
}

/**
 * Apply borders from a table style tcStyle node.
 * Structure: <a:tcStyle> <a:tcBdr> <a:top>/<a:bottom>/<a:left>/<a:right> <a:ln>...
 */
function applyStyleBorders(
  td: HTMLElement,
  tcStyle: SafeXmlNode,
  ctx: RenderContext,
  rowIdx?: number,
  colIdx?: number,
  totalRows?: number,
  totalCols?: number
): void {
  const tcBdr = tcStyle.child('tcBdr')
  if (!tcBdr.exists()) return

  const borderMap: Array<[string, 'borderTop' | 'borderBottom' | 'borderLeft' | 'borderRight']> = [
    ['top', 'borderTop'],
    ['bottom', 'borderBottom'],
    ['left', 'borderLeft'],
    ['right', 'borderRight'],
  ]

  // Map insideH/insideV to individual cell borders:
  // insideH → borderBottom for non-last rows, borderTop for non-first rows
  // insideV → borderRight for non-last cols, borderLeft for non-first cols
  const insideH = tcBdr.child('insideH')
  if (insideH.exists() && rowIdx !== undefined && totalRows !== undefined) {
    if (rowIdx < totalRows - 1) {
      borderMap.push(['insideH', 'borderBottom'])
    }
    if (rowIdx > 0) {
      borderMap.push(['insideH', 'borderTop'])
    }
  }
  const insideV = tcBdr.child('insideV')
  if (insideV.exists() && colIdx !== undefined && totalCols !== undefined) {
    if (colIdx < totalCols - 1) {
      borderMap.push(['insideV', 'borderRight'])
    }
    if (colIdx > 0) {
      borderMap.push(['insideV', 'borderLeft'])
    }
  }

  for (const [xmlName, cssProp] of borderMap) {
    const side = tcBdr.child(xmlName)
    if (!side.exists()) continue

    // Direct <a:ln> element
    const ln = side.child('ln')
    if (ln.exists()) {
      const noFill = ln.child('noFill')
      if (noFill.exists()) continue

      const style = resolveLineStyle(ln, ctx)
      if (style.width > 0 && style.color !== 'transparent') {
        td.style[cssProp] = `${Math.max(style.width, 0.5)}px ${style.dash} ${style.color}`
      }
      continue
    }

    // <a:lnRef> — reference to theme line style (common in table styles)
    const lnRef = side.child('lnRef')
    if (lnRef.exists()) {
      const idx = lnRef.numAttr('idx') ?? 0
      if (idx === 0) continue // idx 0 = no line

      // Resolve color from the lnRef's child color element
      const { color, alpha } = resolveColor(lnRef, ctx)
      const hex = color.startsWith('#') ? color : `#${color}`

      // Get width from theme line style
      let width = 1 // default 1px
      if (ctx.theme.lineStyles && ctx.theme.lineStyles.length >= idx) {
        const themeLn = ctx.theme.lineStyles[idx - 1]
        const themeW = themeLn.numAttr('w') ?? 12700 // default 1pt
        width = emuToPx(themeW)
      }

      const cssColor =
        alpha < 1
          ? `rgba(${hexToRgb(hex).r},${hexToRgb(hex).g},${hexToRgb(hex).b},${alpha.toFixed(3)})`
          : hex
      if (width > 0) {
        td.style[cssProp] = `${Math.max(width, 0.5)}px solid ${cssColor}`
      }
    }
  }
}

/**
 * Apply table-level background from tblStyle > tblBg.
 * tblBg can contain fillRef (theme fill reference) or solidFill.
 */
function applyTableBackground(table: HTMLElement, tblStyle: SafeXmlNode, ctx: RenderContext): void {
  const tblBg = tblStyle.child('tblBg')
  if (!tblBg.exists()) return

  // fillRef: references a theme fill style with a color override
  const fillRef = tblBg.child('fillRef')
  if (fillRef.exists()) {
    const { color, alpha } = resolveColor(fillRef, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      table.style.backgroundColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    } else {
      table.style.backgroundColor = hex
    }
    return
  }

  // solidFill
  const solidFill = tblBg.child('solidFill')
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      table.style.backgroundColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    } else {
      table.style.backgroundColor = hex
    }
  }
}

// ---------------------------------------------------------------------------
// Table Rendering
// ---------------------------------------------------------------------------

/**
 * Render a table node into an absolutely-positioned HTML element.
 */
export function renderTable(node: TableNodeData, ctx: RenderContext): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'absolute'
  wrapper.style.left = `${node.position.x}px`
  wrapper.style.top = `${node.position.y}px`
  wrapper.style.width = `${node.size.w}px`
  wrapper.style.height = `${node.size.h}px`
  wrapper.style.overflow = 'hidden'

  // Apply transforms
  const transforms: string[] = []
  if (node.rotation !== 0) {
    transforms.push(`rotate(${node.rotation}deg)`)
  }
  if (node.flipH) {
    transforms.push('scaleX(-1)')
  }
  if (node.flipV) {
    transforms.push('scaleY(-1)')
  }
  if (transforms.length > 0) {
    wrapper.style.transform = transforms.join(' ')
  }

  // Resolve table style
  const tblStyle = findTableStyle(node.tableStyleId, ctx)
  const tblPr = node.properties
  const totalRows = node.rows.length
  const totalCols = node.columns.length

  // Create table element
  const table = document.createElement('table')
  table.style.borderCollapse = 'collapse'
  table.style.width = '100%'
  table.style.height = '100%'
  table.style.tableLayout = 'fixed'

  // Apply table background from table style (tblBg)
  if (tblStyle) {
    applyTableBackground(table, tblStyle, ctx)
  }

  // Column widths
  const totalWidth = node.columns.reduce((sum, w) => sum + w, 0)
  if (totalWidth > 0 && node.columns.length > 0) {
    const colgroup = document.createElement('colgroup')
    for (const colW of node.columns) {
      const col = document.createElement('col')
      col.style.width = `${(colW / totalWidth) * 100}%`
      colgroup.appendChild(col)
    }
    table.appendChild(colgroup)
  }

  // Compute total row height so we can express each row as a proportion
  const totalRowHeight = node.rows.reduce((sum, r) => sum + r.height, 0)

  // Render rows
  const tbody = document.createElement('tbody')
  let colIdx = 0
  for (let rowIdx = 0; rowIdx < node.rows.length; rowIdx++) {
    const row = node.rows[rowIdx]
    const tr = document.createElement('tr')
    if (row.height > 0 && totalRowHeight > 0) {
      // Use percentage heights so rows stay proportional within the
      // table's constrained height instead of expanding beyond it.
      tr.style.height = `${(row.height / totalRowHeight) * 100}%`
    }

    colIdx = 0
    for (const cell of row.cells) {
      // Skip merged cells
      if (cell.hMerge || cell.vMerge) {
        colIdx++
        continue
      }

      const td = document.createElement('td')
      td.style.overflow = 'hidden'

      // Spanning
      if (cell.gridSpan > 1) {
        td.colSpan = cell.gridSpan
      }
      if (cell.rowSpan > 1) {
        td.rowSpan = cell.rowSpan
      }

      // Apply table style first (as base), then direct tcPr overrides
      let sections: SafeXmlNode[] = []
      if (tblStyle) {
        sections = getStyleSections(tblStyle, rowIdx, colIdx, totalRows, totalCols, tblPr)
        // Apply sections in order (later sections override earlier ones)
        for (const section of sections) {
          const tcStyle = section.child('tcStyle')
          if (tcStyle.exists()) {
            applyStyleFill(td, tcStyle, ctx)
            applyStyleBorders(td, tcStyle, ctx, rowIdx, colIdx, totalRows, totalCols)
          }
        }
      }

      // Apply direct cell properties (override table style)
      applyCellProperties(td, cell, ctx)

      // Resolve table style text properties (color, bold, italic from tcTxStyle)
      const textProps =
        sections.length > 0 ? getEffectiveTableStyleTextProps(sections, ctx) : undefined

      // Render text inside cell
      if (cell.textBody) {
        const opts = textProps
          ? {
              cellTextColor: textProps.color,
              cellTextBold: textProps.bold,
              cellTextItalic: textProps.italic,
              cellTextFontFamily: textProps.fontFamily,
            }
          : undefined
        renderTextBody(cell.textBody, undefined, ctx, td, opts)
      }

      tr.appendChild(td)
      colIdx += cell.gridSpan
    }

    tbody.appendChild(tr)
  }

  table.appendChild(tbody)
  wrapper.appendChild(table)
  return wrapper
}

// ---------------------------------------------------------------------------
// Cell Property Application
// ---------------------------------------------------------------------------

/**
 * Apply table cell properties (tcPr) to a <td> element.
 */
function applyCellProperties(td: HTMLElement, cell: TableCell, ctx: RenderContext): void {
  const tcPr = cell.properties
  if (!tcPr) return

  // Fill (overrides table style fill)
  const solidFill = tcPr.child('solidFill')
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b } = hexToRgb(hex)
      td.style.backgroundColor = `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    } else {
      td.style.backgroundColor = hex
    }
  }

  // Borders (override table style borders)
  applyBorder(td, tcPr, 'lnT', 'borderTop', ctx)
  applyBorder(td, tcPr, 'lnB', 'borderBottom', ctx)
  applyBorder(td, tcPr, 'lnL', 'borderLeft', ctx)
  applyBorder(td, tcPr, 'lnR', 'borderRight', ctx)

  // Margins / Padding
  const marL = tcPr.numAttr('marL')
  const marR = tcPr.numAttr('marR')
  const marT = tcPr.numAttr('marT')
  const marB = tcPr.numAttr('marB')

  // Default margin is 91440 EMU (0.1 inch) = ~9.6px
  const defaultMargin = 91440
  td.style.paddingLeft = `${emuToPx(marL ?? defaultMargin)}px`
  td.style.paddingRight = `${emuToPx(marR ?? defaultMargin)}px`
  td.style.paddingTop = `${emuToPx(marT ?? 45720)}px`
  td.style.paddingBottom = `${emuToPx(marB ?? 45720)}px`

  // Vertical alignment
  const anchor = tcPr.attr('anchor')
  const alignMap: Record<string, string> = {
    t: 'top',
    ctr: 'middle',
    b: 'bottom',
  }
  td.style.verticalAlign = alignMap[anchor || 't'] || 'top'
}

/**
 * Apply a single border to a <td> element from a line node.
 */
function applyBorder(
  td: HTMLElement,
  tcPr: SafeXmlNode,
  lineName: string,
  cssProp: 'borderTop' | 'borderBottom' | 'borderLeft' | 'borderRight',
  ctx: RenderContext
): void {
  const ln = tcPr.child(lineName)
  if (!ln.exists()) return

  // Check for noFill — explicitly clear any border set by table style
  const noFill = ln.child('noFill')
  if (noFill.exists()) {
    td.style[cssProp] = 'none'
    return
  }

  const style = resolveLineStyle(ln, ctx)
  if (style.width > 0 && style.color !== 'transparent') {
    td.style[cssProp] = `${Math.max(style.width, 0.5)}px ${style.dash} ${style.color}`
  }
}
