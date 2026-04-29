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
  hlink: string
  folHlink: string
}

export interface DocumentStyleSummary {
  format: 'docx' | 'pptx'
  theme: {
    name: string
    colors: Partial<ThemeColors>
    fonts: { major: string; minor: string }
  }
  styles?: Array<{
    id: string
    name: string
    type: string
    fontSize?: number
    bold?: boolean
    color?: string
    font?: string
  }>
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

function parseThemeXml(xml: string): DocumentStyleSummary['theme'] {
  const clrSchemeMatch = /<a:clrScheme[^>]*name="([^"]*)"/.exec(xml)
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
    'hlink',
    'folHlink',
  ]
  const colors: Partial<ThemeColors> = {}
  for (const slot of slots) {
    const hex = parseColorSlot(xml, slot)
    if (hex) colors[slot] = hex
  }
  return { name: clrSchemeMatch?.[1] ?? '', colors, fonts: parseFontScheme(xml) }
}

function parseDocxStyles(xml: string): DocumentStyleSummary['styles'] {
  const targetIds = new Set([
    'Normal',
    'DefaultParagraphFont',
    'Heading1',
    'Heading2',
    'Heading3',
    'Title',
    'Subtitle',
  ])
  const results: DocumentStyleSummary['styles'] = []
  const blocks = xml.split('<w:style ')
  for (const block of blocks.slice(1)) {
    const styleId = attr(block, 'w:styleId')
    const styleType = attr(block, 'w:type')
    if (!targetIds.has(styleId) && !styleId.startsWith('Heading')) continue
    const nameMatch = /<w:name w:val="([^"]*)"/.exec(block)
    const name = nameMatch?.[1] ?? styleId
    const szMatch = /<w:sz w:val="(\d+)"/.exec(block)
    const fontSize = szMatch ? Math.round(Number.parseInt(szMatch[1]) / 2) : undefined
    const bold = /<w:b\b(?:\s[^/]*)?\/?>/.test(block) && !/<w:b w:val="0"/.test(block)
    const colorMatch = /<w:color w:val="([A-Fa-f0-9]{6})"/.exec(block)
    const color = colorMatch?.[1]?.toUpperCase()
    const fontMatch = /<w:rFonts[^>]*w:ascii="([^"]*)"/.exec(block)
    const font = fontMatch?.[1]
    results.push({
      id: styleId,
      name,
      type: styleType,
      ...(fontSize !== undefined && { fontSize }),
      ...(bold && { bold }),
      ...(color && { color }),
      ...(font && { font }),
    })
  }
  return results
}

/**
 * Extract a compact style summary from a binary OOXML (.docx or .pptx) buffer.
 * Returns null if the buffer is not a valid ZIP/OOXML file.
 */
export async function extractDocumentStyle(
  buffer: Buffer,
  ext: 'docx' | 'pptx'
): Promise<DocumentStyleSummary | null> {
  if (buffer.length < 4) return null
  for (let i = 0; i < 4; i++) {
    if (buffer[i] !== ZIP_MAGIC[i]) return null
  }

  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buffer)

    const themePath = ext === 'docx' ? 'word/theme/theme1.xml' : 'ppt/theme/theme1.xml'
    const themeFile = zip.file(themePath)
    if (!themeFile) return null

    const theme = parseThemeXml(await themeFile.async('string'))
    const summary: DocumentStyleSummary = { format: ext, theme }

    if (ext === 'docx') {
      const stylesFile = zip.file('word/styles.xml')
      if (stylesFile) {
        const styles = parseDocxStyles(await stylesFile.async('string'))
        if (styles && styles.length > 0) summary.styles = styles
      }
    }

    return summary
  } catch (err) {
    logger.warn('Failed to extract document style from buffer', { error: toError(err).message })
    return null
  }
}
