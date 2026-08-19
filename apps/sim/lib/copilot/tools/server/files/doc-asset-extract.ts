import JSZip from 'jszip'

/**
 * Pulls the reusable design material out of an OOXML document (.pptx/.docx):
 * the theme (color scheme, font scheme, slide size) and every embedded media
 * file, byte-identical. OOXML packages are ZIP archives with fixed part
 * names, so extraction is direct: `ppt|word/theme/theme1.xml` for the theme,
 * `ppt|word/media/*` for assets, `ppt/presentation.xml` for slide size.
 * Read-only over the source bytes.
 */

/** OOXML theme color slots, in scheme order. */
const THEME_COLOR_SLOTS = [
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
] as const

const EMU_PER_INCH = 914400

export interface ExtractedDocTheme {
  format: 'pptx' | 'docx'
  /** Slot → 6-digit uppercase hex, no leading '#'. Only slots the theme defines. */
  colors: Record<string, string>
  fonts: { major?: string; minor?: string }
  /** Slide dimensions in inches (pptx only). */
  slideSize?: { widthIn: number; heightIn: number }
}

export interface ExtractedDocMedia {
  /** Basename inside the package, e.g. "image1.png". */
  name: string
  bytes: Buffer
}

export interface ExtractedDocAssets {
  theme: ExtractedDocTheme
  media: ExtractedDocMedia[]
}

/**
 * A slot's color is either a literal `<a:srgbClr val="RRGGBB"/>` or a system
 * color carrying its resolved value in `lastClr`.
 */
function parseSlotColor(themeXml: string, slot: string): string | undefined {
  const block = themeXml.match(new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`))?.[1]
  if (!block) return undefined
  const hex =
    block.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ??
    block.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1]
  return hex?.toUpperCase()
}

function parseFont(themeXml: string, scheme: 'majorFont' | 'minorFont'): string | undefined {
  const block = themeXml.match(new RegExp(`<a:${scheme}>([\\s\\S]*?)</a:${scheme}>`))?.[1]
  const typeface = block?.match(/<a:latin typeface="([^"]*)"/)?.[1]
  return typeface || undefined
}

export async function extractDocAssets(
  binary: Buffer,
  format: 'pptx' | 'docx'
): Promise<ExtractedDocAssets> {
  const zip = await JSZip.loadAsync(binary)
  const prefix = format === 'pptx' ? 'ppt' : 'word'

  const themeXml = await zip.file(`${prefix}/theme/theme1.xml`)?.async('string')
  const colors: Record<string, string> = {}
  for (const slot of THEME_COLOR_SLOTS) {
    const hex = themeXml ? parseSlotColor(themeXml, slot) : undefined
    if (hex) colors[slot] = hex
  }
  const theme: ExtractedDocTheme = {
    format,
    colors,
    fonts: {
      major: themeXml ? parseFont(themeXml, 'majorFont') : undefined,
      minor: themeXml ? parseFont(themeXml, 'minorFont') : undefined,
    },
  }

  if (format === 'pptx') {
    const presentation = await zip.file('ppt/presentation.xml')?.async('string')
    const size = presentation?.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/)
    if (size) {
      theme.slideSize = {
        widthIn: Number((Number(size[1]) / EMU_PER_INCH).toFixed(2)),
        heightIn: Number((Number(size[2]) / EMU_PER_INCH).toFixed(2)),
      }
    }
  }

  const mediaPrefix = `${prefix}/media/`
  const media: ExtractedDocMedia[] = []
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir || !entryName.startsWith(mediaPrefix)) continue
    const name = entryName.slice(mediaPrefix.length)
    if (!name || name.includes('/')) continue
    media.push({ name, bytes: await entry.async('nodebuffer') })
  }
  media.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  return { theme, media }
}
