import JSZip from 'jszip'

/**
 * Pulls the reusable design material out of an OOXML document (.pptx/.docx):
 * the theme (color scheme, font scheme, slide size), every embedded media
 * file byte-identical, and — for pptx — a slide-by-slide layout of text
 * blocks (content, frame, font, size, color) and placed images. OOXML
 * packages are ZIP archives with fixed part names, so extraction is direct:
 * `ppt|word/theme/theme1.xml` for the theme, `ppt|word/media/*` for assets,
 * `ppt/presentation.xml` for slide size, and `ppt/slides/slideN.xml` (plus
 * each slide's layout/master chain for inherited placeholder frames) for the
 * layout. Read-only over the source bytes.
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
const MAX_TEXTS_PER_SLIDE = 80
const MAX_TEXT_CHARS = 400

export interface DocImagePlacement {
  slide: number
  xIn: number
  yIn: number
  wIn: number
  hIn: number
}

/** An asset's placement on one slide, by its media basename. */
export interface PptxPlacedImage {
  name: string
  xIn: number
  yIn: number
  wIn: number
  hIn: number
}

export interface PptxTextBlock {
  text: string
  xIn: number
  yIn: number
  wIn: number
  hIn: number
  /** Typeface name, or "major"/"minor" when the run uses a theme font slot. */
  font?: string
  sizePt?: number
  bold?: boolean
  italic?: boolean
  /** Literal run color. Absent when the run uses a theme slot instead. */
  colorHex?: string
  /** Theme color slot name (e.g. "accent1") — resolve via theme.json colors. */
  schemeColor?: string
}

/** One slide's rebuild recipe: what sits where, in which font and color. */
export interface PptxSlideLayout {
  slide: number
  texts: PptxTextBlock[]
  images: PptxPlacedImage[]
}

export interface ExtractedDocTheme {
  format: 'pptx' | 'docx'
  /** Slot → 6-digit uppercase hex, no leading '#'. Only slots the theme defines. */
  colors: Record<string, string>
  fonts: { major?: string; minor?: string }
  /** Slide dimensions in inches (pptx only). */
  slideSize?: { widthIn: number; heightIn: number }
  slideCount?: number
  /** Per-asset slide-by-slide placements in inches (pptx only). */
  images?: Record<string, { placements: DocImagePlacement[] }>
}

export interface ExtractedDocMedia {
  /** Basename inside the package, e.g. "image1.png". */
  name: string
  bytes: Buffer
}

export interface ExtractedDocAssets {
  theme: ExtractedDocTheme
  media: ExtractedDocMedia[]
  /** Slide-by-slide rebuild recipe (pptx only; empty for docx). */
  layout: PptxSlideLayout[]
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

const emuToIn = (emu: string): number => Number((Number(emu) / EMU_PER_INCH).toFixed(2))

interface ShapeFrame {
  xIn: number
  yIn: number
  wIn: number
  hIn: number
}

/**
 * Placeholder frame lookup falls back across interchangeable ph types: a
 * slide's "title" inherits from a layout's centered title and vice versa.
 */
const PH_TYPE_ALIASES: Record<string, readonly string[]> = {
  title: ['title', 'ctrTitle'],
  ctrTitle: ['ctrTitle', 'title'],
  body: ['body', 'subTitle'],
  subTitle: ['subTitle', 'body'],
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
}

function decodeXml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9A-Fa-f]+|#\d+);/g, (entity) => {
    const named = XML_ENTITIES[entity]
    if (named) return named
    const code = entity.startsWith('&#x')
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function parseFrame(block: string): ShapeFrame | null {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
  if (!off || !ext) return null
  return { xIn: emuToIn(off[1]), yIn: emuToIn(off[2]), wIn: emuToIn(ext[1]), hIn: emuToIn(ext[2]) }
}

function parsePlaceholder(sp: string): { idx?: string; type?: string } | null {
  const attrs = sp.match(/<p:ph\b([^>]*)>/)?.[1]
  if (attrs === undefined) return null
  return { idx: attrs.match(/ idx="(\d+)"/)?.[1], type: attrs.match(/ type="([^"]+)"/)?.[1] }
}

/**
 * Drops grouped shapes from a slide/layout XML. Group members carry
 * group-relative coordinates that need the full chOff/chExt transform to
 * place absolutely; omitting them beats emitting frames at wrong positions.
 * Balanced scan rather than a regex so nested groups drop cleanly.
 */
function stripGroups(xml: string): string {
  let out = ''
  let depth = 0
  let last = 0
  for (const tag of xml.matchAll(/<\/?p:grpSp>/g)) {
    const at = tag.index ?? 0
    if (depth === 0 && tag[0] === '<p:grpSp>') out += xml.slice(last, at)
    depth = tag[0] === '<p:grpSp>' ? depth + 1 : Math.max(0, depth - 1)
    if (depth === 0) last = at + tag[0].length
  }
  return depth === 0 ? out + xml.slice(last) : out
}

/** Frames of a layout/master's placeholder shapes, keyed by idx and type. */
function collectPlaceholderFrames(xml: string): Map<string, ShapeFrame> {
  const frames = new Map<string, ShapeFrame>()
  for (const sp of stripGroups(xml).matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const ph = parsePlaceholder(sp[0])
    if (!ph) continue
    const frame = parseFrame(sp[0])
    if (!frame) continue
    if (ph.idx !== undefined && !frames.has(`idx:${ph.idx}`)) frames.set(`idx:${ph.idx}`, frame)
    if (ph.type !== undefined && !frames.has(`type:${ph.type}`))
      frames.set(`type:${ph.type}`, frame)
  }
  return frames
}

/** Resolves a rels Target like "../slideLayouts/slideLayout1.xml" to a zip path. */
function resolveZipPath(baseDir: string, target: string): string {
  const resolved: string[] = []
  for (const part of `${baseDir}/${target}`.split('/')) {
    if (part === '..') resolved.pop()
    else if (part !== '.' && part !== '') resolved.push(part)
  }
  return resolved.join('/')
}

function matchRelTarget(relsXml: string, typeSuffix: string, baseDir: string): string | undefined {
  for (const rel of relsXml.matchAll(/<Relationship [^>]*>/g)) {
    const type = rel[0].match(/ Type="([^"]+)"/)?.[1]
    const target = rel[0].match(/ Target="([^"]+)"/)?.[1]
    if (target && type?.endsWith(`/${typeSuffix}`)) return resolveZipPath(baseDir, target)
  }
  return undefined
}

function relsPathFor(partPath: string): string {
  const cut = partPath.lastIndexOf('/')
  return `${partPath.slice(0, cut)}/_rels/${partPath.slice(cut + 1)}.rels`
}

/**
 * A slide shape without its own xfrm inherits its frame from the matching
 * placeholder in the slide's layout, then the layout's master. Parsed frames
 * are cached per layout part since slides share layouts.
 */
async function inheritedFramesForSlide(
  zip: JSZip,
  slideRelsXml: string,
  cache: Map<string, Map<string, ShapeFrame>>
): Promise<Map<string, ShapeFrame>> {
  const layoutPath = matchRelTarget(slideRelsXml, 'slideLayout', 'ppt/slides')
  if (!layoutPath) return new Map()
  const cached = cache.get(layoutPath)
  if (cached) return cached
  const layoutXml = (await zip.file(layoutPath)?.async('string')) ?? ''
  const frames = collectPlaceholderFrames(layoutXml)
  const layoutRelsXml = await zip.file(relsPathFor(layoutPath))?.async('string')
  const layoutDir = layoutPath.slice(0, layoutPath.lastIndexOf('/'))
  const masterPath = layoutRelsXml
    ? matchRelTarget(layoutRelsXml, 'slideMaster', layoutDir)
    : undefined
  if (masterPath) {
    const masterXml = (await zip.file(masterPath)?.async('string')) ?? ''
    for (const [key, frame] of collectPlaceholderFrames(masterXml)) {
      if (!frames.has(key)) frames.set(key, frame)
    }
  }
  cache.set(layoutPath, frames)
  return frames
}

function lookupPlaceholderFrame(
  ph: { idx?: string; type?: string },
  frames: Map<string, ShapeFrame>
): ShapeFrame | null {
  if (ph.idx !== undefined) {
    const byIdx = frames.get(`idx:${ph.idx}`)
    if (byIdx) return byIdx
  }
  for (const type of ph.type ? (PH_TYPE_ALIASES[ph.type] ?? [ph.type]) : []) {
    const byType = frames.get(`type:${type}`)
    if (byType) return byType
  }
  return null
}

function collectSlideTexts(
  slideXml: string,
  inheritedFrames: Map<string, ShapeFrame>
): PptxTextBlock[] {
  const texts: PptxTextBlock[] = []
  for (const sp of stripGroups(slideXml).matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    if (texts.length >= MAX_TEXTS_PER_SLIDE) break
    const txBody = sp[0].match(/<p:txBody>([\s\S]*?)<\/p:txBody>/)?.[1]
    if (!txBody) continue
    const text = [...txBody.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((para) =>
        [...para[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join('')
      )
      .filter((line) => line.trim().length > 0)
      .join('\n')
      .slice(0, MAX_TEXT_CHARS)
    if (!text) continue
    const ph = parsePlaceholder(sp[0])
    const frame = parseFrame(sp[0]) ?? (ph ? lookupPlaceholderFrame(ph, inheritedFrames) : null)
    if (!frame) continue
    // Style is read from the shape's first styled run — the way decks are
    // authored (one style per box) — without resolving list/master styles.
    const rPrAttrs = txBody.match(/<a:rPr\b([^>]*)>/)?.[1] ?? ''
    const sz = rPrAttrs.match(/ sz="(\d+)"/)?.[1]
    const typeface = txBody.match(/<a:latin typeface="([^"]+)"/)?.[1]
    const colorHex = txBody.match(/<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1]
    texts.push({
      text,
      ...frame,
      font: typeface === '+mj-lt' ? 'major' : typeface === '+mn-lt' ? 'minor' : typeface,
      sizePt: sz ? Number(sz) / 100 : undefined,
      bold: / b="1"/.test(rPrAttrs) ? true : undefined,
      italic: / i="1"/.test(rPrAttrs) ? true : undefined,
      colorHex: colorHex?.toUpperCase(),
      schemeColor: colorHex
        ? undefined
        : txBody.match(/<a:solidFill><a:schemeClr val="([^"]+)"/)?.[1],
    })
  }
  return texts
}

/**
 * Walks every slide once, producing both indexes of the same facts: the
 * per-asset placement lists for theme.json and the per-slide text/image
 * layout. Slide rels resolve rIds to media basenames, and each <p:pic>/<p:sp>
 * frame carries its offset/extent in EMU (or inherits it via placeholder).
 */
async function collectSlideLayouts(zip: JSZip): Promise<{
  slideCount: number
  images: Record<string, { placements: DocImagePlacement[] }>
  slides: PptxSlideLayout[]
}> {
  const images: Record<string, { placements: DocImagePlacement[] }> = {}
  const slides: PptxSlideLayout[] = []
  const placeholderFrameCache = new Map<string, Map<string, ShapeFrame>>()
  const slideNames = Object.keys(zip.files)
    .map((name) => name.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
  for (const match of slideNames) {
    const slide = Number(match[1])
    const slideXml = (await zip.file(match[0])?.async('string')) ?? ''
    const relsXml = await zip.file(`ppt/slides/_rels/slide${slide}.xml.rels`)?.async('string')
    const relToMedia = new Map<string, string>()
    if (relsXml) {
      for (const rel of relsXml.matchAll(/<Relationship [^>]*>/g)) {
        const id = rel[0].match(/ Id="([^"]+)"/)?.[1]
        const target = rel[0].match(/ Target="([^"]+)"/)?.[1]
        if (id && target?.includes('/media/')) {
          relToMedia.set(id, target.slice(target.lastIndexOf('/') + 1))
        }
      }
    }
    const placed: PptxPlacedImage[] = []
    for (const pic of slideXml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)) {
      const embed = pic[0].match(/r:embed="([^"]+)"/)?.[1]
      const name = embed ? relToMedia.get(embed) : undefined
      if (!name) continue
      const frame = parseFrame(pic[0])
      if (!frame) continue
      images[name] ??= { placements: [] }
      images[name].placements.push({ slide, ...frame })
      placed.push({ name, ...frame })
    }
    const inheritedFrames = relsXml
      ? await inheritedFramesForSlide(zip, relsXml, placeholderFrameCache)
      : new Map<string, ShapeFrame>()
    slides.push({ slide, texts: collectSlideTexts(slideXml, inheritedFrames), images: placed })
  }
  return { slideCount: slideNames.length, images, slides }
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

  let layout: PptxSlideLayout[] = []
  if (format === 'pptx') {
    const presentation = await zip.file('ppt/presentation.xml')?.async('string')
    const size = presentation?.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/)
    if (size) {
      theme.slideSize = {
        widthIn: Number((Number(size[1]) / EMU_PER_INCH).toFixed(2)),
        heightIn: Number((Number(size[2]) / EMU_PER_INCH).toFixed(2)),
      }
    }
    const { slideCount, images, slides } = await collectSlideLayouts(zip)
    theme.slideCount = slideCount
    if (Object.keys(images).length > 0) theme.images = images
    layout = slides
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

  return { theme, media, layout }
}
