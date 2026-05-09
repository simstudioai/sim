/**
 * Text renderer — converts OOXML text body into HTML DOM elements
 * with full 7-level style inheritance.
 */

import type { PlaceholderInfo } from '../model/nodes/base-node'
import type { TextBody } from '../model/nodes/shape-node'
import { angleToDeg, emuToPx, pctToDecimal } from '../parser/units'
import { SafeXmlNode } from '../parser/xml-parser'
import { isAllowedExternalUrl } from '../utils/url-safety'
import type { RenderContext } from './render-context'
import { resolveColor, resolveColorToCss } from './style-resolver'

// ---------------------------------------------------------------------------
// Style Inheritance Helpers
// ---------------------------------------------------------------------------

/**
 * Find paragraph properties at a specific indent level from a list style node.
 * Tries lvl{n}pPr (where n = level + 1), then falls back to defPPr.
 */
function findStyleAtLevel(styleNode: SafeXmlNode | undefined, level: number): SafeXmlNode {
  if (!styleNode || !styleNode.exists()) {
    return new SafeXmlNode(null)
  }
  // Try level-specific style (lvl1pPr, lvl2pPr, etc.)
  const lvlNode = styleNode.child(`lvl${level + 1}pPr`)
  if (lvlNode.exists()) return lvlNode
  // Fall back to default
  return styleNode.child('defPPr')
}

/**
 * Determine the placeholder category for style inheritance.
 * Returns 'title', 'body', or 'other'.
 */
function getPlaceholderCategory(
  placeholder: PlaceholderInfo | undefined
): 'title' | 'body' | 'other' {
  if (!placeholder || !placeholder.type) return 'other'
  const t = placeholder.type
  if (t === 'title' || t === 'ctrTitle') return 'title'
  if (
    t === 'body' ||
    t === 'subTitle' ||
    t === 'obj' ||
    t === 'dt' ||
    t === 'ftr' ||
    t === 'sldNum'
  ) {
    return 'body'
  }
  return 'other'
}

/**
 * Find a placeholder node in a list by matching type and/or idx.
 */
function findPlaceholderNode(
  placeholders: SafeXmlNode[],
  info: PlaceholderInfo
): SafeXmlNode | undefined {
  for (const ph of placeholders) {
    // Navigate to the ph element to read its attributes
    let phEl: SafeXmlNode | undefined
    const nvSpPr = ph.child('nvSpPr')
    if (nvSpPr.exists()) {
      phEl = nvSpPr.child('nvPr').child('ph')
    }
    if (!phEl || !phEl.exists()) {
      const nvPicPr = ph.child('nvPicPr')
      if (nvPicPr.exists()) {
        phEl = nvPicPr.child('nvPr').child('ph')
      }
    }
    if (!phEl || !phEl.exists()) continue

    const phType = phEl.attr('type')
    const phIdx = phEl.numAttr('idx')

    // Match by idx first (most specific), then by type
    if (info.idx !== undefined && phIdx === info.idx) return ph
    if (info.type && phType === info.type) return ph
  }
  return undefined
}

/**
 * Extract lstStyle from a placeholder shape node.
 */
function getPlaceholderLstStyle(phNode: SafeXmlNode): SafeXmlNode | undefined {
  const txBody = phNode.child('txBody')
  if (!txBody.exists()) return undefined
  const lstStyle = txBody.child('lstStyle')
  return lstStyle.exists() ? lstStyle : undefined
}

/**
 * Merge a source paragraph property node onto a target style object.
 * Later calls override earlier values (higher priority wins).
 */
interface MergedParagraphStyle {
  align?: string
  marginLeft?: number
  textIndent?: number
  lineHeight?: string
  /** True when lineHeight comes from spcPts (absolute pt value). For CJK fonts, CSS line-height
   *  with absolute values may not produce exact spacing because the font's content area can exceed
   *  the line-height. When true, we use block-level line wrappers instead of <br> for line breaks. */
  lineHeightAbsolute?: boolean
  spaceBefore?: number
  spaceBeforePct?: number // percentage of font size (0-1 range)
  spaceAfter?: number
  spaceAfterPct?: number // percentage of font size (0-1 range)
  bulletChar?: string
  bulletFont?: string
  bulletAutoNum?: string
  bulletNone?: boolean
  /** When set, bullet color is taken from this OOXML buClr node (a:buClr with srgbClr/schemeClr child). */
  bulletColorNode?: SafeXmlNode
  defRPr?: SafeXmlNode
}

function mergeParagraphProps(target: MergedParagraphStyle, pPr: SafeXmlNode): void {
  if (!pPr.exists()) return

  const algn = pPr.attr('algn')
  if (algn) target.align = algn

  const marL = pPr.numAttr('marL')
  if (marL !== undefined) target.marginLeft = emuToPx(marL)

  const indent = pPr.numAttr('indent')
  if (indent !== undefined) target.textIndent = emuToPx(indent)

  // Line spacing
  // OOXML spcPct: 100000 = "single spacing" = 1.0× the font's line height.
  // IMPORTANT: We must use UNITLESS CSS line-height values (e.g., 1.0, 1.2)
  // instead of percentages (e.g., 100%, 120%). CSS percentage line-height is
  // computed once against the element's own font-size and inherited as a FIXED
  // pixel value — so a parent div with line-height:120% and font-size:16px
  // inherits 19.2px to ALL children, even those with font-size:80pt.
  // Unitless values are inherited as-is and each child recomputes against its
  // own font-size.
  const lnSpc = pPr.child('lnSpc')
  if (lnSpc.exists()) {
    const spcPct = lnSpc.child('spcPct')
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val')
      if (val !== undefined) {
        // OOXML 100000 → CSS unitless 1.0; OOXML 120000 → CSS 1.2
        target.lineHeight = `${(val / 100000).toFixed(3)}`
      }
    }
    const spcPts = lnSpc.child('spcPts')
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val')
      if (val !== undefined) {
        target.lineHeight = `${val / 100}pt`
        target.lineHeightAbsolute = true
      }
    }
  }

  // Space before
  const spcBef = pPr.child('spcBef')
  if (spcBef.exists()) {
    const spcPts = spcBef.child('spcPts')
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val')
      if (val !== undefined) target.spaceBefore = val / 100
    }
    const spcPct = spcBef.child('spcPct')
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val')
      if (val !== undefined) target.spaceBeforePct = val / 100000 // store as ratio
    }
  }

  // Space after
  const spcAft = pPr.child('spcAft')
  if (spcAft.exists()) {
    const spcPts = spcAft.child('spcPts')
    if (spcPts.exists()) {
      const val = spcPts.numAttr('val')
      if (val !== undefined) target.spaceAfter = val / 100
    }
    const spcPct = spcAft.child('spcPct')
    if (spcPct.exists()) {
      const val = spcPct.numAttr('val')
      if (val !== undefined) target.spaceAfterPct = val / 100000 // store as ratio
    }
  }

  // Bullets
  const buChar = pPr.child('buChar')
  if (buChar.exists()) {
    target.bulletChar = buChar.attr('char') || ''
    target.bulletNone = false
  }
  const buAutoNum = pPr.child('buAutoNum')
  if (buAutoNum.exists()) {
    target.bulletAutoNum = buAutoNum.attr('type') || 'arabicPeriod'
    target.bulletNone = false
  }
  const buNone = pPr.child('buNone')
  if (buNone.exists()) {
    target.bulletNone = true
    target.bulletChar = undefined
    target.bulletAutoNum = undefined
  }
  const buFont = pPr.child('buFont')
  if (buFont.exists()) {
    target.bulletFont = buFont.attr('typeface')
  }
  // Explicit bullet color (a:buClr); when present overrides defRPr for bullet color
  const buClr = pPr.child('buClr')
  if (buClr.exists()) {
    target.bulletColorNode = buClr
  }

  // Default run properties (used as fallback for runs without rPr)
  const defRPr = pPr.child('defRPr')
  if (defRPr.exists()) {
    target.defRPr = defRPr
  }
}

// ---------------------------------------------------------------------------
// Run Style Resolution
// ---------------------------------------------------------------------------

interface MergedRunStyle {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  color?: string
  fontFamily?: string
  hlinkClick?: string
  /** Character spacing (tracking) in points — from a:spc @val (hundredths of pt). */
  letterSpacingPt?: number
  /** Kerning: minimum font size (pt) for kerning; 0 = always kern. */
  kern?: number
  /** Text capitalization: "all" = ALL CAPS, "small" = SMALL CAPS, "none" = normal. */
  cap?: string
  /** Baseline shift in percentage (positive = superscript, negative = subscript). */
  baseline?: number
  /** CSS gradient string for text fill (from rPr > gradFill). */
  textGradientCss?: string
  /** When true, text fill is transparent (a:noFill on rPr). */
  textNoFill?: boolean
  /** Text outline width in px (from a:ln on rPr). */
  textOutlineWidth?: number
  /** Text outline CSS color (solid fill on ln). */
  textOutlineColor?: string
  /** Text outline CSS gradient (gradient fill on ln) — used as mask-image for fade effect. */
  textOutlineGradientCss?: string
}

function mergeRunProps(target: MergedRunStyle, rPr: SafeXmlNode, ctx: RenderContext): void {
  if (!rPr.exists()) return

  const sz = rPr.numAttr('sz')
  if (sz !== undefined) target.fontSize = sz / 100 // hundredths of point -> pt

  const b = rPr.attr('b')
  if (b !== undefined) target.bold = b === '1' || b === 'true'

  const i = rPr.attr('i')
  if (i !== undefined) target.italic = i === '1' || i === 'true'

  const u = rPr.attr('u')
  if (u !== undefined && u !== 'none') target.underline = true
  if (u === 'none') target.underline = false

  const strike = rPr.attr('strike')
  if (strike !== undefined && strike !== 'noStrike') target.strikethrough = true
  if (strike === 'noStrike') target.strikethrough = false

  // Color from solidFill or gradFill child
  const solidFill = rPr.child('solidFill')
  if (solidFill.exists()) {
    const { color, alpha } = resolveColor(solidFill, ctx)
    const hex = color.startsWith('#') ? color : `#${color}`
    if (alpha < 1) {
      const { r, g, b: bl } = hexToRgbInternal(hex)
      target.color = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`
    } else {
      target.color = hex
    }
  }
  const gradFill = rPr.child('gradFill')
  if (gradFill.exists()) {
    const css = resolveGradientForText(gradFill, ctx)
    if (css) target.textGradientCss = css
  }

  // Font family
  const latin = rPr.child('latin')
  if (latin.exists()) {
    const typeface = latin.attr('typeface')
    if (typeface) {
      target.fontFamily = resolveThemeFont(typeface, ctx)
    }
  }
  if (!target.fontFamily) {
    const ea = rPr.child('ea')
    if (ea.exists()) {
      const typeface = ea.attr('typeface')
      if (typeface) {
        target.fontFamily = resolveThemeFont(typeface, ctx)
      }
    }
  }
  if (!target.fontFamily) {
    const cs = rPr.child('cs')
    if (cs.exists()) {
      const typeface = cs.attr('typeface')
      if (typeface) {
        target.fontFamily = resolveThemeFont(typeface, ctx)
      }
    }
  }

  // Hyperlink
  const hlinkClick = rPr.child('hlinkClick')
  if (hlinkClick.exists()) {
    // The actual URL is in the slide rels, referenced by r:id
    const rId = hlinkClick.attr('id') ?? hlinkClick.attr('r:id')
    if (rId) {
      const rel = ctx.slide.rels.get(rId)
      if (rel && rel.targetMode === 'External' && isAllowedExternalUrl(rel.target)) {
        target.hlinkClick = rel.target
      }
    }
  }

  // Character spacing (compact/tracking): rPr@spc in hundredths of a point
  const spc = rPr.numAttr('spc')
  if (spc !== undefined) target.letterSpacingPt = spc / 100

  // Kerning: rPr@kern = minimum font size (hundredths of pt) to apply kerning; 0 = always
  const kern = rPr.numAttr('kern')
  if (kern !== undefined) target.kern = kern / 100

  // Text capitalization: cap="all" (ALL CAPS) or cap="small" (SMALL CAPS)
  const cap = rPr.attr('cap')
  if (cap !== undefined) target.cap = cap

  // Baseline shift: positive = superscript, negative = subscript (in 1000ths of percent)
  const baseline = rPr.numAttr('baseline')
  if (baseline !== undefined) target.baseline = baseline

  // Text noFill: a:noFill on rPr makes text interior transparent
  if (rPr.child('noFill').exists()) {
    target.textNoFill = true
  }

  // Text outline: a:ln on rPr defines text stroke/outline
  const ln = rPr.child('ln')
  if (ln.exists() && !ln.child('noFill').exists()) {
    const lnW = ln.numAttr('w')
    target.textOutlineWidth = lnW ? emuToPx(lnW) : 0.75 // default ~0.75px
    // Solid fill on outline
    const lnSolid = ln.child('solidFill')
    if (lnSolid.exists()) {
      const { color: c, alpha: a } = resolveColor(lnSolid, ctx)
      target.textOutlineColor = colorToCssLocal(c, a)
    }
    // Gradient fill on outline — build CSS gradient for mask effect
    const lnGrad = ln.child('gradFill')
    if (lnGrad.exists()) {
      target.textOutlineGradientCss = resolveGradientForText(lnGrad, ctx)
    }
  }
}

/**
 * Resolve theme font placeholder references like "+mj-lt" or "+mn-lt".
 */
function resolveThemeFont(typeface: string, ctx: RenderContext): string {
  if (typeface === '+mj-lt' || typeface === '+mj-ea' || typeface === '+mj-cs') {
    const key = typeface.slice(3) as 'lt' | 'ea' | 'cs'
    const mapping: Record<string, 'latin' | 'ea' | 'cs'> = { lt: 'latin', ea: 'ea', cs: 'cs' }
    return ctx.theme.majorFont[mapping[key] || 'latin'] || typeface
  }
  if (typeface === '+mn-lt' || typeface === '+mn-ea' || typeface === '+mn-cs') {
    const key = typeface.slice(3) as 'lt' | 'ea' | 'cs'
    const mapping: Record<string, 'latin' | 'ea' | 'cs'> = { lt: 'latin', ea: 'ea', cs: 'cs' }
    return ctx.theme.minorFont[mapping[key] || 'latin'] || typeface
  }
  return typeface
}

/**
 * Minimal hex-to-rgb parser for inline use.
 */
function hexToRgbInternal(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, '')
  const num = Number.parseInt(
    cleaned.length === 3
      ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2]
      : cleaned,
    16
  )
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

/**
 * Convert resolved color + alpha to CSS color string.
 */
function colorToCssLocal(color: string, alpha: number): string {
  const hex = color.startsWith('#') ? color : `#${color}`
  if (alpha >= 1) return hex
  const { r, g, b } = hexToRgbInternal(hex)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
}

/**
 * Resolve a gradient fill node into a CSS linear-gradient string.
 * Used for text outline gradient effects.
 */
function resolveGradientForText(gradFill: SafeXmlNode, ctx: RenderContext): string {
  const gsLst = gradFill.child('gsLst')
  const stops: { position: number; color: string }[] = []
  for (const gs of gsLst.children('gs')) {
    const pos = gs.numAttr('pos') ?? 0
    const posPercent = pctToDecimal(pos) * 100
    const { color, alpha } = resolveColor(gs, ctx)
    stops.push({ position: posPercent, color: colorToCssLocal(color, alpha) })
  }
  if (stops.length === 0) return ''
  stops.sort((a, b) => a.position - b.position)
  const stopsStr = stops.map((s) => `${s.color} ${s.position.toFixed(1)}%`).join(', ')
  const lin = gradFill.child('lin')
  if (lin.exists()) {
    const angle = angleToDeg(lin.numAttr('ang') ?? 0)
    const cssAngle = (angle + 90) % 360
    return `linear-gradient(${cssAngle.toFixed(1)}deg, ${stopsStr})`
  }
  return `linear-gradient(180deg, ${stopsStr})`
}

// ---------------------------------------------------------------------------
// Bullet Generation
// ---------------------------------------------------------------------------

function generateAutoNumber(type: string, index: number): string {
  const num = index + 1
  switch (type) {
    case 'arabicPeriod':
      return `${num}.`
    case 'arabicParenR':
      return `${num})`
    case 'arabicParenBoth':
      return `(${num})`
    case 'arabicPlain':
      return `${num}`
    case 'romanUcPeriod':
      return `${toRoman(num)}.`
    case 'romanLcPeriod':
      return `${toRoman(num).toLowerCase()}.`
    case 'alphaUcPeriod':
      return `${String.fromCharCode(64 + (((num - 1) % 26) + 1))}.`
    case 'alphaLcPeriod':
      return `${String.fromCharCode(96 + (((num - 1) % 26) + 1))}.`
    case 'alphaUcParenR':
      return `${String.fromCharCode(64 + (((num - 1) % 26) + 1))})`
    case 'alphaLcParenR':
      return `${String.fromCharCode(96 + (((num - 1) % 26) + 1))})`
    default:
      return `${num}.`
  }
}

function toRoman(num: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
  let result = ''
  let remaining = num
  for (let i = 0; i < vals.length; i++) {
    while (remaining >= vals[i]) {
      result += syms[i]
      remaining -= vals[i]
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Main Render Function
// ---------------------------------------------------------------------------

/**
 * Render a text body into the provided container element.
 *
 * Implements 7-level style inheritance:
 * 1. master.defaultTextStyle
 * 2. master.textStyles[category] (titleStyle / bodyStyle / otherStyle)
 * 3. master placeholder lstStyle
 * 4. layout placeholder lstStyle
 * 5. shape lstStyle
 * 6. paragraph pPr
 * 7. run rPr
 */
/** Optional overrides when rendering text (e.g. table cell style text properties from tcTxStyle). */
interface RenderTextBodyOptions {
  /** When set, used as text color when the run has no explicit color (e.g. table style tcTxStyle). */
  cellTextColor?: string
  /** When set, applies bold from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextBold?: boolean
  /** When set, applies italic from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextItalic?: boolean
  /** When set, applies font family from table style tcTxStyle (overrides inherited, yields to explicit run rPr). */
  cellTextFontFamily?: string
  /** fontRef color from shape style (e.g. SmartArt). Overrides inherited styles but yields to explicit run rPr color. */
  fontRefColor?: string
}

export function renderTextBody(
  textBody: TextBody,
  placeholder: PlaceholderInfo | undefined,
  ctx: RenderContext,
  container: HTMLElement,
  options?: RenderTextBodyOptions
): void {
  const category = getPlaceholderCategory(placeholder)
  let bulletCounter = 0

  // Parse normAutofit from bodyPr (font scaling + line spacing reduction)
  let fontScale = 1
  let lnSpcReduction = 0
  if (textBody.bodyProperties) {
    const normAutofit = textBody.bodyProperties.child('normAutofit')
    if (normAutofit.exists()) {
      const fs = normAutofit.numAttr('fontScale')
      if (fs !== undefined) fontScale = fs / 100000 // 100000 = 100%
      const lsr = normAutofit.numAttr('lnSpcReduction')
      if (lsr !== undefined) lnSpcReduction = lsr / 100000 // e.g., 20000 = 20%
    }
  }

  for (const paragraph of textBody.paragraphs) {
    const paraDiv = document.createElement('div')
    const level = paragraph.level

    // ---- Build merged paragraph style (7-level inheritance) ----
    const merged: MergedParagraphStyle = {}

    // Level 1: master defaultTextStyle
    mergeParagraphProps(merged, findStyleAtLevel(ctx.master.defaultTextStyle, level))

    // Level 2: master text styles by category
    const masterTextStyle =
      category === 'title'
        ? ctx.master.textStyles.titleStyle
        : category === 'body'
          ? ctx.master.textStyles.bodyStyle
          : ctx.master.textStyles.otherStyle
    mergeParagraphProps(merged, findStyleAtLevel(masterTextStyle, level))

    // Level 3: master placeholder lstStyle
    if (placeholder) {
      const masterPh = findPlaceholderNode(ctx.master.placeholders, placeholder)
      if (masterPh) {
        const lstStyle = getPlaceholderLstStyle(masterPh)
        mergeParagraphProps(merged, findStyleAtLevel(lstStyle, level))
      }
    }

    // Level 4: layout placeholder lstStyle
    if (placeholder) {
      const layoutPh = findPlaceholderNode(
        ctx.layout.placeholders.map((e) => e.node),
        placeholder
      )
      if (layoutPh) {
        const lstStyle = getPlaceholderLstStyle(layoutPh)
        mergeParagraphProps(merged, findStyleAtLevel(lstStyle, level))
      }
    }

    // Level 5: shape lstStyle
    mergeParagraphProps(merged, findStyleAtLevel(textBody.listStyle, level))

    // Level 6: paragraph pPr
    if (paragraph.properties) {
      mergeParagraphProps(merged, paragraph.properties)
    }

    // ---- Apply paragraph styles ----
    if (merged.align) {
      const alignMap: Record<string, string> = {
        l: 'left',
        ctr: 'center',
        r: 'right',
        just: 'justify',
        dist: 'justify',
      }
      paraDiv.style.textAlign = alignMap[merged.align] || 'left'
    }
    if (merged.marginLeft !== undefined) {
      paraDiv.style.marginLeft = `${merged.marginLeft}px`
    }
    if (merged.textIndent !== undefined) {
      paraDiv.style.textIndent = `${merged.textIndent}px`
    }
    // Compute effective line-height (with optional lnSpcReduction from normAutofit)
    let effectiveLineHeight = merged.lineHeight
    if (merged.lineHeight) {
      if (lnSpcReduction > 0) {
        const parsed = Number.parseFloat(merged.lineHeight)
        if (!Number.isNaN(parsed)) {
          if (merged.lineHeight.includes('pt')) {
            effectiveLineHeight = `${(parsed * (1 - lnSpcReduction)).toFixed(2)}pt`
          } else {
            effectiveLineHeight = `${(parsed * (1 - lnSpcReduction)).toFixed(3)}`
          }
        }
      }
      paraDiv.style.lineHeight = effectiveLineHeight!
    }
    // Determine effective font size for percentage-based spacing
    // Use defRPr or first run's font size, fallback to 12pt
    let effectiveFontSize = 12 // default 12pt
    if (merged.defRPr) {
      const sz = merged.defRPr.numAttr('sz')
      if (sz !== undefined) effectiveFontSize = sz / 100
    }
    if (paragraph.runs.length > 0 && paragraph.runs[0].properties) {
      const sz = paragraph.runs[0].properties.numAttr('sz')
      if (sz !== undefined) effectiveFontSize = sz / 100
    }

    if (merged.spaceBefore !== undefined) {
      paraDiv.style.marginTop = `${merged.spaceBefore}pt`
    } else if (merged.spaceBeforePct !== undefined) {
      paraDiv.style.marginTop = `${merged.spaceBeforePct * effectiveFontSize}pt`
    }
    if (merged.spaceAfter !== undefined) {
      paraDiv.style.marginBottom = `${merged.spaceAfter}pt`
    } else if (merged.spaceAfterPct !== undefined) {
      paraDiv.style.marginBottom = `${merged.spaceAfterPct * effectiveFontSize}pt`
    }

    // ---- Bullets ----
    // Suppress bullets for metadata placeholders (slide number, date, footer)
    // Also suppress for empty paragraphs (no visible runs) — PowerPoint never shows bullets for them
    const hasVisibleRuns = paragraph.runs.some((r) => r.text != null && r.text.length > 0)
    const suppressBullet =
      !hasVisibleRuns ||
      placeholder?.type === 'sldNum' ||
      placeholder?.type === 'dt' ||
      placeholder?.type === 'ftr' ||
      placeholder?.type === 'title' ||
      placeholder?.type === 'ctrTitle' ||
      placeholder?.type === 'subTitle'
    let bulletPrefix = ''
    if (!suppressBullet && merged.bulletNone !== true) {
      if (merged.bulletChar) {
        bulletPrefix = merged.bulletChar
      } else if (merged.bulletAutoNum) {
        bulletPrefix = generateAutoNumber(merged.bulletAutoNum, bulletCounter)
        bulletCounter++
      }
    }

    if (bulletPrefix) {
      const bulletSpan = document.createElement('span')
      bulletSpan.textContent = `${bulletPrefix} `
      if (merged.bulletFont) {
        bulletSpan.style.fontFamily = merged.bulletFont
      }
      // Bullet color: 1) explicit buClr from list style, 2) paragraph defRPr, 3) first run's color (so bullet matches text), 4) cell/fallback
      let bulletColor: string | undefined
      if (merged.bulletColorNode?.exists()) {
        bulletColor = resolveColorToCss(merged.bulletColorNode, ctx)
      }
      if (bulletColor === undefined && merged.defRPr && merged.defRPr.exists()) {
        const bulletRunStyle: MergedRunStyle = {}
        mergeRunProps(bulletRunStyle, merged.defRPr, ctx)
        bulletColor = bulletRunStyle.color
      }
      if (bulletColor === undefined && paragraph.runs.length > 0) {
        const runStyle: MergedRunStyle = {}
        if (merged.defRPr) mergeRunProps(runStyle, merged.defRPr, ctx)
        if (paragraph.runs[0].properties) mergeRunProps(runStyle, paragraph.runs[0].properties, ctx)
        bulletColor = runStyle.color
      }
      // Fallback: check shape's lstStyle defRPr for color (same as run fallback)
      if (bulletColor === undefined && textBody.listStyle) {
        const lstStyleLevel = findStyleAtLevel(textBody.listStyle, level)
        if (lstStyleLevel.exists()) {
          const lstDefRPr = lstStyleLevel.child('defRPr')
          if (lstDefRPr.exists()) {
            const fallbackStyle: MergedRunStyle = {}
            mergeRunProps(fallbackStyle, lstDefRPr, ctx)
            if (fallbackStyle.color !== undefined) {
              bulletColor = fallbackStyle.color
            }
          }
        }
      }
      bulletSpan.style.color =
        bulletColor ?? options?.fontRefColor ?? options?.cellTextColor ?? '#000000'
      paraDiv.appendChild(bulletSpan)
    }

    // ---- Render runs ----
    if (paragraph.runs.length === 0) {
      // Empty paragraph — still need to maintain spacing
      paraDiv.appendChild(document.createElement('br'))
    }

    // When line spacing is absolute (spcPts) and paragraph has line breaks,
    // wrap each line in a block-level div with explicit height. This ensures
    // exact spacing regardless of font metrics (CJK fonts e.g. Microsoft YaHei have
    // content areas taller than font-size, causing CSS line-height to be
    // overridden by the font's natural spacing).
    const hasLineBreaks = paragraph.runs.some((r) => r.text === '\n')
    // Set tab-size when paragraph contains tab characters (default OOXML tab spacing = 914400 EMU = 96px)
    if (paragraph.runs.some((r) => r.text?.includes('\t'))) {
      const defaultTabPx = 96 // 914400 EMU at 96 dpi
      paraDiv.style.tabSize = `${defaultTabPx}px`
    }
    const useLineWrappers = merged.lineHeightAbsolute && hasLineBreaks && effectiveLineHeight
    let currentLineDiv: HTMLElement | null = null
    if (useLineWrappers) {
      currentLineDiv = document.createElement('div')
      currentLineDiv.style.height = effectiveLineHeight!
      currentLineDiv.style.overflow = 'visible'
      paraDiv.appendChild(currentLineDiv)
    }

    for (const run of paragraph.runs) {
      if (run.text === '\n') {
        if (useLineWrappers) {
          // Close current line div and start a new one
          currentLineDiv = document.createElement('div')
          currentLineDiv.style.height = effectiveLineHeight!
          currentLineDiv.style.overflow = 'visible'
          paraDiv.appendChild(currentLineDiv)
        } else {
          paraDiv.appendChild(document.createElement('br'))
        }
        continue
      }

      // Build merged run style
      const runStyle: MergedRunStyle = {}

      // Apply default run properties from merged paragraph defRPr
      if (merged.defRPr) {
        mergeRunProps(runStyle, merged.defRPr, ctx)
      }

      // Level 7: run rPr
      if (run.properties) {
        mergeRunProps(runStyle, run.properties, ctx)
      }

      // Fallback: if no color resolved yet, check the shape's lstStyle defRPr.
      // This handles the case where paragraph pPr has an empty <a:defRPr/> that
      // overwrites the lstStyle's defRPr (which may carry solidFill color).
      if (runStyle.color === undefined && textBody.listStyle) {
        const lstStyleLevel = findStyleAtLevel(textBody.listStyle, level)
        if (lstStyleLevel.exists()) {
          const lstDefRPr = lstStyleLevel.child('defRPr')
          if (lstDefRPr.exists()) {
            const fallbackStyle: MergedRunStyle = {}
            mergeRunProps(fallbackStyle, lstDefRPr, ctx)
            if (fallbackStyle.color !== undefined) {
              runStyle.color = fallbackStyle.color
            }
          }
        }
      }

      // Determine if this should be a link
      let element: HTMLElement
      if (runStyle.hlinkClick) {
        const a = document.createElement('a')
        a.href = runStyle.hlinkClick
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        element = a
      } else {
        element = document.createElement('span')
      }

      // Preserve consecutive spaces by alternating with &nbsp; so they survive
      // HTML whitespace collapse without being stretched by text-align:justify.
      // Tabs still need white-space:pre for tab-stop rendering.
      if (run.text?.includes('\t')) {
        element.textContent = run.text
        element.style.whiteSpace = 'pre'
      } else if (run.text && / {2}/.test(run.text)) {
        // Replace pairs of spaces with " &nbsp;" so browsers cannot collapse them,
        // while normal spaces between words remain stretchable for justify.
        const escaped = run.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/ {2}/g, ' \u00a0')
        element.innerHTML = escaped
      } else {
        element.textContent = run.text
      }

      // Apply run styles (with normAutofit fontScale)
      // Default to 12pt if no font size specified at any inheritance level
      const fontSize = runStyle.fontSize || 12
      element.style.fontSize = `${fontSize * fontScale}pt`
      // Bold: explicit run rPr > cellTextBold (table style tcTxStyle) > inherited styles
      const hasExplicitRunBold = run.properties?.attr('b') !== undefined
      if (hasExplicitRunBold ? runStyle.bold : (options?.cellTextBold ?? runStyle.bold)) {
        element.style.fontWeight = 'bold'
      }
      // Italic: explicit run rPr > cellTextItalic (table style tcTxStyle) > inherited styles
      const hasExplicitRunItalic = run.properties?.attr('i') !== undefined
      if (hasExplicitRunItalic ? runStyle.italic : (options?.cellTextItalic ?? runStyle.italic)) {
        element.style.fontStyle = 'italic'
      }

      const decorations: string[] = []
      if (runStyle.underline) decorations.push('underline')
      if (runStyle.strikethrough) decorations.push('line-through')
      if (decorations.length > 0) {
        element.style.textDecoration = decorations.join(' ')
      }

      // Color priority: explicit run rPr > hlink theme color > cellTextColor (table style tcTxStyle) > fontRef (shape style) > inherited styles > black default
      // cellTextColor from table style overrides inherited cascade colors but yields to explicit run/paragraph solidFill/gradFill.
      // fontRefColor overrides inherited styles but yields to explicit run solidFill/gradFill.
      const hasExplicitRunColor =
        run.properties?.child('solidFill').exists() || run.properties?.child('gradFill').exists()
      let effectiveColor: string | undefined
      if (options?.fontRefColor) {
        effectiveColor = hasExplicitRunColor ? runStyle.color : options.fontRefColor
      } else if (options?.cellTextColor && !hasExplicitRunColor) {
        effectiveColor = options.cellTextColor
      } else {
        effectiveColor = runStyle.color
      }

      // Hyperlink default color: when the run is a hyperlink and has no explicit
      // solidFill on its own rPr, use the theme's hlink color.  This matches
      // PowerPoint behaviour where hyperlink text defaults to the hlink scheme color.
      if (runStyle.hlinkClick && !hasExplicitRunColor) {
        const hlinkHex = ctx.theme.colorScheme.get('hlink')
        if (hlinkHex) {
          effectiveColor = hlinkHex.startsWith('#') ? hlinkHex : `#${hlinkHex}`
        }
      }

      if (effectiveColor) {
        element.style.color = effectiveColor
      } else {
        // No explicit color from run/paragraph/style: use black so text does not inherit page CSS (e.g. body { color: #e0e0e0 })
        element.style.color = '#000000'
      }

      // Gradient text fill: use background-clip to paint text with gradient
      if (runStyle.textGradientCss) {
        element.style.background = runStyle.textGradientCss
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(element.style as any).webkitBackgroundClip = 'text'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(element.style as any).backgroundClip = 'text'
        element.style.color = 'transparent'
      }

      // Text outline (a:ln on rPr) and noFill handling
      if (runStyle.textNoFill || runStyle.textOutlineWidth) {
        const strokeW = runStyle.textOutlineWidth ?? 0.75
        if (runStyle.textNoFill && runStyle.textOutlineGradientCss) {
          // Ghost text: no fill + gradient outline → show outline fading via mask
          const outlineColor = '#ffffff' // base stroke color (gradient applied via mask)
          element.style.color = 'transparent'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeWidth = `${strokeW}px`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeColor = outlineColor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).paintOrder = 'stroke fill'
          // Use mask-image to apply the gradient fade to the entire text element
          const maskGrad = runStyle.textOutlineGradientCss
          element.style.maskImage = maskGrad
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitMaskImage = maskGrad
        } else if (runStyle.textNoFill && runStyle.textOutlineColor) {
          // Ghost text with solid outline
          element.style.color = 'transparent'
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeWidth = `${strokeW}px`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeColor = runStyle.textOutlineColor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).paintOrder = 'stroke fill'
        } else if (runStyle.textNoFill) {
          // noFill with no outline — invisible text (but keep space)
          element.style.color = 'transparent'
        } else if (runStyle.textOutlineColor) {
          // Outline with normal fill
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeWidth = `${strokeW}px`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).webkitTextStrokeColor = runStyle.textOutlineColor
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(element.style as any).paintOrder = 'stroke fill'
        }
      }

      // Font family: explicit run rPr > cellTextFontFamily (table style) > inherited > theme fallback
      const hasExplicitRunFont =
        run.properties?.child('latin').exists() ||
        run.properties?.child('ea').exists() ||
        run.properties?.child('cs').exists()
      const effectiveFont = hasExplicitRunFont
        ? runStyle.fontFamily
        : (options?.cellTextFontFamily ?? runStyle.fontFamily)
      if (effectiveFont) {
        element.style.fontFamily = `"${effectiveFont}"`
      } else {
        // Fallback to theme minor font
        const fallback = ctx.theme.minorFont.latin || ctx.theme.minorFont.ea
        if (fallback) {
          element.style.fontFamily = `"${fallback}"`
        }
      }

      // Character spacing (a:spc) — compact/tracking in points
      if (runStyle.letterSpacingPt !== undefined) {
        element.style.letterSpacing = `${runStyle.letterSpacingPt}pt`
      }
      // Kerning (a:kern): val = min font size (pt) to kern; 0 = always kern
      if (runStyle.kern !== undefined) {
        const effectivePt = (runStyle.fontSize || 12) * fontScale
        element.style.fontKerning = effectivePt >= runStyle.kern ? 'normal' : 'none'
      }

      // Text capitalization (a:rPr@cap)
      if (runStyle.cap === 'all') {
        element.style.textTransform = 'uppercase'
      } else if (runStyle.cap === 'small') {
        element.style.fontVariant = 'small-caps'
      }

      // Baseline shift (superscript/subscript)
      if (runStyle.baseline !== undefined && runStyle.baseline !== 0) {
        // OOXML baseline is in 1000ths of percent; positive = superscript, negative = subscript
        const shiftPct = runStyle.baseline / 1000
        element.style.verticalAlign = `${shiftPct}%`
        // Reduce font size for super/subscript
        if (Math.abs(shiftPct) >= 20) {
          element.style.fontSize = `${fontSize * fontScale * 0.65}pt`
        }
      }

      // Append to the current line wrapper (when using absolute line spacing)
      // or directly to the paragraph div
      const appendTarget = currentLineDiv ?? paraDiv
      appendTarget.appendChild(element)
    }

    // endParaRPr: when the paragraph ends with a line break (trailing \n),
    // the end-of-paragraph mark (endParaRPr) defines the font size for the
    // trailing blank line. Without this, bottom-anchored text boxes render
    // content too low because the trailing space is too small.
    if (paragraph.endParaRPr) {
      const lastRun = paragraph.runs[paragraph.runs.length - 1]
      if (lastRun?.text === '\n') {
        const epSz = paragraph.endParaRPr.numAttr('sz')
        if (epSz !== undefined) {
          const spacer = document.createElement('span')
          spacer.textContent = '\u200B' // zero-width space to maintain line height
          spacer.style.fontSize = `${(epSz / 100) * fontScale}pt`
          const target = currentLineDiv ?? paraDiv
          target.appendChild(spacer)
        }
      }
    }

    container.appendChild(paraDiv)
  }
}
