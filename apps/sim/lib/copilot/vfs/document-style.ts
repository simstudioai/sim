import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'

const logger = createLogger('DocumentStyle')

// ZIP magic bytes: PK\x03\x04
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

interface ThemeColors {
  dk1: string
  lt1: string
  dk2: string
  lt2: string
  accent1: string
  accent2: string
  accent3: string
  accent4: string
  accent5: string
  accent6: string
}

export interface DocumentStyleSummary {
  format: 'docx' | 'pptx' | 'pdf'
  /** OOXML theme — present for pptx; present for docx when theme1.xml exists; absent for pdf */
  theme?: {
    colors: Partial<ThemeColors>
    fonts: { major: string; minor: string }
  }
  /** Named paragraph/character styles — docx only */
  styles?: Array<{
    id: string
    name: string
    type: string
    fontSize?: number
    bold?: boolean
    color?: string
    font?: string
  }>
  /** Document-wide default run properties (body text baseline) — docx only */
  defaults?: {
    fontSize?: number
    font?: string
  }
  /** Page dimensions — pdf only. widthPt/heightPt present only when preset is 'custom' */
  pageSize?: {
    preset: 'A4' | 'letter' | 'custom'
    widthPt?: number
    heightPt?: number
  }
  /** Embedded font names extracted from page resource dictionaries — pdf only */
  fonts?: string[]
  /** Number of slides — pptx only */
  slideCount?: number
  /** Slide aspect ratio — pptx only */
  aspectRatio?: '16:9' | '4:3' | 'custom'
  /** Slide master background hex color (no #) — pptx only, absent when background is transparent/image */
  background?: string
}

function attr(xml: string, name: string): string {
  const rx = new RegExp(`${name}="([^"]*)"`)
  return rx.exec(xml)?.[1] ?? ''
}

function between(xml: string, open: string, close: string): string {
  const start = xml.indexOf(open)
  if (start < 0) return ''
  const end = xml.indexOf(close, start + open.length)
  if (end < 0) return ''
  return xml.slice(start + open.length, end)
}

function parseColorSlot(xml: string, slot: string): string {
  const inner = between(xml, `<a:${slot}>`, `</a:${slot}>`)
  if (!inner) return ''
  // srgbClr uses val=; sysClr has val="windowText" but lastClr holds the fallback hex
  const srgb = attr(inner, 'val')
  if (srgb && inner.includes('<a:srgbClr')) return srgb.toUpperCase()
  const lastClr = attr(inner, 'lastClr')
  if (lastClr) return lastClr.toUpperCase()
  return ''
}

function parseFontScheme(xml: string): { major: string; minor: string } {
  const major = between(xml, '<a:majorFont>', '</a:majorFont>')
  const minor = between(xml, '<a:minorFont>', '</a:minorFont>')
  return { major: attr(major, 'typeface') || '', minor: attr(minor, 'typeface') || '' }
}

function parseThemeXml(xml: string): NonNullable<DocumentStyleSummary['theme']> {
  const slots: Array<keyof ThemeColors> = [
    'dk1',
    'lt1',
    'dk2',
    'lt2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
  ]
  const colors: Partial<ThemeColors> = {}
  for (const slot of slots) {
    const hex = parseColorSlot(xml, slot)
    if (hex) colors[slot] = hex
  }
  return { colors, fonts: parseFontScheme(xml) }
}

type StyleRaw = {
  id: string
  name: string
  type: string
  basedOn?: string
  fontSize?: number
  bold?: boolean
  color?: string
  font?: string
  /** Raw w:asciiTheme value — resolved to a font name after parsing */
  themeFont?: string
}

function resolveThemeFont(themeFont: string, themeFonts: { major: string; minor: string }): string {
  const ref = themeFont.toLowerCase()
  return ref.includes('major') ? themeFonts.major : themeFonts.minor
}

function parseFontAttrs(
  fontAttrsXml: string,
  themeFonts?: { major: string; minor: string }
): { font?: string; themeFont?: string } {
  const asciiLit = /\bw:ascii="([^"]+)"/.exec(fontAttrsXml)
  // LibreOffice DOCX files may put a semicolon-separated fallback list in w:ascii — take the first
  if (asciiLit) return { font: asciiLit[1].split(';')[0].trim() || asciiLit[1] }
  const themeRef = /\bw:asciiTheme="([^"]+)"/.exec(fontAttrsXml)
  if (!themeRef) return {}
  // Resolve immediately if theme fonts are available, otherwise defer
  if (themeFonts) return { font: resolveThemeFont(themeRef[1], themeFonts) }
  return { themeFont: themeRef[1] }
}

function parseDocxStyles(
  xml: string,
  themeFonts?: { major: string; minor: string }
): {
  styles: NonNullable<DocumentStyleSummary['styles']>
  defaults?: DocumentStyleSummary['defaults']
} {
  // Extract document-default run properties (the baseline for body text)
  const defaults: DocumentStyleSummary['defaults'] = {}
  const docDefaultsBlock = between(xml, '<w:docDefaults>', '</w:docDefaults>')
  if (docDefaultsBlock) {
    const rPrBlock = between(docDefaultsBlock, '<w:rPrDefault>', '</w:rPrDefault>')
    if (rPrBlock) {
      const szMatch = /<w:sz w:val="(\d+)"/.exec(rPrBlock)
      if (szMatch) defaults.fontSize = Math.round(Number.parseInt(szMatch[1]) / 2)
      const fontAttrMatch = /<w:rFonts([^>]*)>/.exec(rPrBlock)
      if (fontAttrMatch) {
        const { font } = parseFontAttrs(fontAttrMatch[1], themeFonts)
        if (font) defaults.font = font
      }
    }
  }

  // Build a full style map for basedOn inheritance resolution
  const styleMap = new Map<string, StyleRaw>()
  for (const block of xml.split('<w:style ').slice(1)) {
    const id = attr(block, 'w:styleId')
    if (!id) continue
    const type = attr(block, 'w:type')
    const nameMatch = /<w:name w:val="([^"]*)"/.exec(block)
    const basedOnMatch = /<w:basedOn w:val="([^"]*)"/.exec(block)
    const szMatch = /<w:sz w:val="(\d+)"/.exec(block)
    const colorMatch = /<w:color w:val="([A-Fa-f0-9]{6})"/.exec(block)
    const fontAttrMatch = /<w:rFonts([^>]*)>/.exec(block)
    const { font, themeFont } = fontAttrMatch ? parseFontAttrs(fontAttrMatch[1], themeFonts) : {}

    styleMap.set(id, {
      id,
      name: nameMatch?.[1] ?? id,
      type,
      ...(basedOnMatch && { basedOn: basedOnMatch[1] }),
      ...(szMatch && { fontSize: Math.round(Number.parseInt(szMatch[1]) / 2) }),
      ...(/<w:b\b(?:\s[^/]*)?\/?>/.test(block) && {
        bold: !/<w:b\b[^>]*\bw:val=["'](0|false)["']/.test(block),
      }),
      ...(colorMatch && { color: colorMatch[1].toUpperCase() }),
      ...(font && { font }),
      ...(themeFont && { themeFont }),
    })
  }

  function resolveInheritance(id: string, visited = new Set<string>()): StyleRaw | undefined {
    if (visited.has(id)) return undefined
    visited.add(id)
    const s = styleMap.get(id)
    if (!s) return undefined
    if (!s.basedOn) return s
    const parent = resolveInheritance(s.basedOn, visited)
    if (!parent) return s
    // Own properties override parent; undefined falls through to parent
    return {
      ...parent,
      ...s,
      fontSize: s.fontSize ?? parent.fontSize,
      bold: s.bold ?? parent.bold,
      color: s.color ?? parent.color,
      font: s.font ?? parent.font,
      themeFont: s.themeFont ?? parent.themeFont,
    }
  }

  // Target paragraph styles (character styles excluded — generation works at paragraph level)
  const targetIds: string[] = ['Normal', 'BodyText', 'Body Text', 'Title', 'Subtitle']
  for (const id of styleMap.keys()) {
    // Match both 'Heading1' (Office) and 'heading1' (LibreOffice) style IDs
    if (/^[Hh]eading\d/.test(id) && !targetIds.includes(id)) targetIds.push(id)
  }

  const styles: NonNullable<DocumentStyleSummary['styles']> = []
  const seen = new Set<string>()
  for (const id of targetIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const resolved = resolveInheritance(id)
    if (!resolved || resolved.type !== 'paragraph') continue

    // Deferred theme font resolution (only reached when themeFonts was unavailable during parse)
    let resolvedFont = resolved.font
    if (!resolvedFont && resolved.themeFont && themeFonts) {
      resolvedFont = resolveThemeFont(resolved.themeFont, themeFonts)
    }

    styles.push({
      id: resolved.id,
      name: resolved.name,
      type: resolved.type,
      ...(resolved.fontSize !== undefined && { fontSize: resolved.fontSize }),
      ...(resolved.bold !== undefined && { bold: resolved.bold }),
      ...(resolved.color && { color: resolved.color }),
      ...(resolvedFont && { font: resolvedFont }),
    })
  }

  return {
    styles,
    ...(Object.keys(defaults).length > 0 && { defaults }),
  }
}

async function extractPdfStyle(buffer: Buffer): Promise<DocumentStyleSummary | null> {
  try {
    const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib')

    let doc: Awaited<ReturnType<typeof PDFDocument.load>>
    try {
      doc = await PDFDocument.load(buffer, { updateMetadata: false })
    } catch {
      // Encrypted or corrupt
      return null
    }

    const pages = doc.getPages()
    if (pages.length === 0) return null

    // Page dimensions (first page is canonical for preset detection)
    const { width: widthPt, height: heightPt } = pages[0].getSize()
    let preset: 'A4' | 'letter' | 'custom' = 'custom'
    if (Math.abs(widthPt - 595.28) < 5 && Math.abs(heightPt - 841.89) < 5) preset = 'A4'
    else if (Math.abs(widthPt - 612) < 5 && Math.abs(heightPt - 792) < 5) preset = 'letter'

    // Font names from page resource dictionaries (first 10 pages to bound cost)
    const rawFontNames = new Set<string>()
    const pagesToScan = Math.min(pages.length, 10)
    for (let i = 0; i < pagesToScan; i++) {
      try {
        const resourcesRef = pages[i].node.get(PDFName.of('Resources'))
        if (!resourcesRef) continue
        const resources = doc.context.lookup(resourcesRef, PDFDict)
        if (!resources) continue
        const fontDictRef = resources.get(PDFName.of('Font'))
        if (!fontDictRef) continue
        const fontDict = doc.context.lookup(fontDictRef, PDFDict)
        if (!fontDict) continue
        for (const key of fontDict.keys()) {
          try {
            const fontRef = fontDict.get(key)
            if (!fontRef) continue
            const fontObj = doc.context.lookup(fontRef, PDFDict)
            if (!fontObj) continue
            const baseFontRef = fontObj.get(PDFName.of('BaseFont'))
            if (!baseFontRef) continue
            // Format: "/ABCDEF+FontName" (subset) or "/FontName" (full embed)
            const raw = baseFontRef
              .toString()
              .replace(/^\//, '')
              .replace(/^[A-Z]{6}\+/, '')
            if (raw) rawFontNames.add(raw)
          } catch {}
        }
      } catch {}
    }

    // Normalize to unique font family names by stripping PostScript weight/style suffixes.
    // Apply the strip in a loop to handle compound suffixes (e.g. SemiBoldItalic, LightOblique).
    // BoldMT must precede Bold, Oblique must precede the simple form, etc.
    const SUFFIX_RX =
      /[-]?(BoldMT|BoldOblique|BoldItalic|SemiBoldItalic|ExtraBoldItalic|LightItalic|LightOblique|MediumItalic|Regular|ExtraBold|SemiBold|Medium|Black|Light|Bold|Italic|Oblique|Condensed|Expanded|MT)$/i
    const familyNames = [
      ...new Set(
        [...rawFontNames].map((name) => {
          let n = name
          // Strip up to 3 suffix components to handle compound PostScript names
          for (let i = 0; i < 3; i++) {
            const stripped = n.replace(SUFFIX_RX, '').trim()
            if (stripped === n) break
            n = stripped
          }
          return n
        })
      ),
    ].filter(Boolean)

    // Omit exact dimensions when the preset already encodes the page size
    const pageSize: DocumentStyleSummary['pageSize'] =
      preset === 'custom'
        ? { widthPt: Math.round(widthPt), heightPt: Math.round(heightPt), preset }
        : { preset }

    return {
      format: 'pdf',
      pageSize,
      ...(familyNames.length > 0 && { fonts: familyNames }),
    }
  } catch (err) {
    logger.warn('Failed to extract PDF style', { error: toError(err).message })
    return null
  }
}

function parsePptxPresentation(xml: string): {
  slideCount: number
  aspectRatio: '16:9' | '4:3' | 'custom'
} {
  // Count sldId elements inside sldIdLst
  const sldIdLst = between(xml, '<p:sldIdLst>', '</p:sldIdLst>')
  const slideCount = (sldIdLst.match(/<p:sldId\b/g) ?? []).length

  // Slide size in EMU — 1 inch = 914400 EMU. Capture cx/cy independently so
  // attribute order (LibreOffice/Google Slides may write cy before cx) doesn't matter.
  const cxMatch = /<p:sldSz\b[^>]*\bcx="(\d+)"/.exec(xml)
  const cyMatch = /<p:sldSz\b[^>]*\bcy="(\d+)"/.exec(xml)
  let aspectRatio: '16:9' | '4:3' | 'custom' = 'custom'
  if (cxMatch && cyMatch) {
    const cx = Number.parseInt(cxMatch[1])
    const cy = Number.parseInt(cyMatch[1])
    const ratio = cx / cy
    if (Math.abs(ratio - 16 / 9) < 0.01) aspectRatio = '16:9'
    else if (Math.abs(ratio - 4 / 3) < 0.01) aspectRatio = '4:3'
  }

  return { slideCount, aspectRatio }
}

function parseSlideMasterBackground(xml: string): string | undefined {
  // Look for a solid fill color in the slide master background
  const bgBlock = between(xml, '<p:bg>', '</p:bg>')
  if (!bgBlock) return undefined
  // solidFill with srgbClr
  const srgbMatch = /<a:srgbClr\b[^>]*\bval="([A-Fa-f0-9]{6})"/.exec(bgBlock)
  if (srgbMatch) return srgbMatch[1].toUpperCase()
  // solidFill with sysClr fallback
  const sysMatch = /<a:sysClr\b[^>]*\blastClr="([A-Fa-f0-9]{6})"/.exec(bgBlock)
  if (sysMatch) return sysMatch[1].toUpperCase()
  return undefined
}

/**
 * Extract a compact style summary from a binary document buffer.
 * Supports .docx and .pptx (OOXML/ZIP) and .pdf.
 * Returns null if the buffer cannot be parsed or yields no useful data.
 */
export async function extractDocumentStyle(
  buffer: Buffer,
  ext: 'docx' | 'pptx' | 'pdf'
): Promise<DocumentStyleSummary | null> {
  if (ext === 'pdf') {
    return extractPdfStyle(buffer)
  }

  if (buffer.length < 4) return null
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== ZIP_MAGIC[i]) return null
  }

  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    const themePath = ext === 'docx' ? 'word/theme/theme1.xml' : 'ppt/theme/theme1.xml'
    const themeFile = zip.file(themePath)

    let theme: DocumentStyleSummary['theme']
    if (themeFile) {
      theme = parseThemeXml(await themeFile.async('string'))
    } else if (ext === 'pptx') {
      // PPTX without a theme is malformed — nothing useful to return
      return null
    }
    // DOCX without a theme is valid (e.g. LibreOffice-generated); continue with styles only

    const summary: DocumentStyleSummary = { format: ext, ...(theme && { theme }) }

    if (ext === 'docx') {
      const stylesFile = zip.file('word/styles.xml')
      if (stylesFile) {
        const { styles, defaults } = parseDocxStyles(await stylesFile.async('string'), theme?.fonts)
        if (styles.length > 0) summary.styles = styles
        if (defaults) summary.defaults = defaults
      }
      // If there's neither a theme nor any styles, there's nothing useful to return
      if (!theme && !summary.styles?.length) return null
    }

    if (ext === 'pptx') {
      const presFile = zip.file('ppt/presentation.xml')
      if (presFile) {
        const { slideCount, aspectRatio } = parsePptxPresentation(await presFile.async('string'))
        if (slideCount > 0) summary.slideCount = slideCount
        summary.aspectRatio = aspectRatio
      }
      const masterFile =
        zip.file('ppt/slideMasters/slideMaster1.xml') ??
        zip.file('ppt/slidemaster/slidemaster1.xml')
      if (masterFile) {
        const bg = parseSlideMasterBackground(await masterFile.async('string'))
        if (bg) summary.background = bg
      }
    }

    return summary
  } catch (err) {
    logger.warn('Failed to extract document style from buffer', { error: toError(err).message })
    return null
  }
}
