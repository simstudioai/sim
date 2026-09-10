import JSZip from 'jszip'
import {
  childElements,
  findAll,
  findFirst,
  formatTableRow,
  imageAltText,
  isXmlElement,
  joinBlocks,
  NOTES_MARKER,
  parseXml,
  readXmlPart,
  TABLE_CLOSE,
  TABLE_OPEN,
  type XmlElement,
} from '@/lib/file-parsers/office-text'
import type { FileParseOptions } from '@/lib/file-parsers/types'

/**
 * Structured text extraction for PresentationML (`.pptx`/`.pptm`/`.potx`) that
 * walks the slide XML directly instead of flattening every `<a:p>` in the
 * package. Each slide's shape tree is read in document order, recursing into
 * group shapes; placeholder shapes that only carry layout boilerplate (slide
 * number, date, header, footer) are skipped; tables are rendered row by row;
 * and presenter notes contribute only their body placeholder, which is how
 * python-pptx, MarkItDown, and Docling read them.
 *
 * Only the matched XML parts are inflated — media entries are never touched.
 */

const SLIDE_PART = /^ppt\/slides\/slide(\d+)\.xml$/
const NOTES_RELATIONSHIP_SUFFIX = '/notesSlide'
const NOTES_PART_PREFIX = 'ppt/notesSlides/'

/**
 * The slide-number field's cached text is the layout's, not the author's. Date
 * fields keep their text: outside a `dt` placeholder (already skipped) a deck's
 * dates are content, and python-pptx keeps them too.
 */
const SLIDE_NUMBER_FIELD_TYPE = 'slidenum'

/** Layout-chrome placeholders whose text is a field, not slide content. */
const SKIPPED_PLACEHOLDER_TYPES = new Set(['sldNum', 'dt', 'ftr', 'hdr'])

const TITLE_PLACEHOLDER_TYPES = new Set(['title', 'ctrTitle'])

function placeholderType(shape: XmlElement): string | null {
  const nonVisual = childElements(shape).find((child) => child.name === 'p:nvSpPr')
  if (!nonVisual) return null
  const placeholder = findFirst(nonVisual, 'p:ph')
  if (!placeholder) return null
  return placeholder.attribs.type ?? 'body'
}

/**
 * Concatenates a DrawingML paragraph's runs, turning `<a:br/>` into a newline
 * and skipping slide-number fields wherever they appear.
 */
function paragraphText(paragraph: XmlElement): string {
  const pieces: string[] = []
  const visit = (element: XmlElement): void => {
    if (element.name === 'a:br') {
      pieces.push('\n')
      return
    }
    if (element.name === 'a:fld' && element.attribs.type === SLIDE_NUMBER_FIELD_TYPE) {
      return
    }
    if (element.name === 'a:t') {
      for (const child of element.children) {
        if (child.type === 'text') pieces.push(child.data)
      }
      return
    }
    for (const child of element.children) {
      if (isXmlElement(child)) visit(child)
    }
  }
  visit(paragraph)
  return pieces
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

/** One line per `<a:p>` in a text body, skipping empty paragraphs. */
function textBodyLines(container: XmlElement): string[] {
  const lines: string[] = []
  for (const paragraph of findAll(container, 'a:p')) {
    const text = paragraphText(paragraph)
    if (text) lines.push(text)
  }
  return lines
}

function shapeBlocks(shape: XmlElement): string[] {
  const type = placeholderType(shape)
  if (type && SKIPPED_PLACEHOLDER_TYPES.has(type)) return []

  const textBody = childElements(shape).find((child) => child.name === 'p:txBody')
  if (!textBody) return []

  const lines = textBodyLines(textBody)
  if (lines.length === 0) return []

  if (type && TITLE_PLACEHOLDER_TYPES.has(type)) {
    return [lines.join(' '), '']
  }
  return [lines.join('\n')]
}

function tableBlocks(table: XmlElement): string[] {
  const rows: string[] = []
  for (const row of findAll(table, 'a:tr')) {
    const cells = childElements(row)
      .filter((cell) => cell.name === 'a:tc')
      .map((cell) => textBodyLines(cell).join(' '))
    if (cells.some((cell) => cell.length > 0)) rows.push(formatTableRow(cells))
  }
  return rows.length > 0 ? [TABLE_OPEN, ...rows, TABLE_CLOSE] : []
}

function graphicFrameBlocks(frame: XmlElement): string[] {
  const table = findFirst(frame, 'a:tbl')
  return table ? tableBlocks(table) : []
}

/** A picture contributes its alternative text, as the HTML walker does for `<img alt>`. */
function pictureBlocks(picture: XmlElement): string[] {
  const nonVisual = childElements(picture).find((child) => child.name === 'p:nvPicPr')
  const properties = nonVisual ? findFirst(nonVisual, 'p:cNvPr') : null
  const image = imageAltText(properties?.attribs.descr)
  return image ? [image] : []
}

/**
 * Markup-compatibility wrapper: the `mc:Fallback` branch is what every
 * consumer renders, so it is preferred; otherwise the first `mc:Choice`.
 */
function alternateContentBranch(element: XmlElement): XmlElement | null {
  const children = childElements(element)
  return (
    children.find((child) => child.name === 'mc:Fallback') ??
    children.find((child) => child.name === 'mc:Choice') ??
    null
  )
}

/** Walks a shape tree (or group) in document order. */
function shapeTreeBlocks(tree: XmlElement): string[] {
  const blocks: string[] = []
  for (const child of childElements(tree)) {
    switch (child.name) {
      case 'p:sp':
        blocks.push(...shapeBlocks(child))
        break
      case 'p:grpSp':
        blocks.push(...shapeTreeBlocks(child))
        break
      case 'p:graphicFrame':
        blocks.push(...graphicFrameBlocks(child))
        break
      case 'p:pic':
        blocks.push(...pictureBlocks(child))
        break
      case 'mc:AlternateContent': {
        const branch = alternateContentBranch(child)
        if (branch) blocks.push(...shapeTreeBlocks(branch))
        break
      }
      default:
        break
    }
  }
  return blocks
}

function slideBodyBlocks(slideXml: string): string[] {
  const document = parseXml(slideXml)
  const tree = findFirst(document, 'p:spTree')
  return tree ? shapeTreeBlocks(tree) : []
}

/** Only the `body` placeholder of a notes page carries the presenter's notes. */
function notesBodyLines(notesXml: string): string[] {
  const document = parseXml(notesXml)
  const tree = findFirst(document, 'p:spTree')
  if (!tree) return []

  const lines: string[] = []
  for (const shape of findAll(tree, 'p:sp')) {
    if (placeholderType(shape) !== 'body') continue
    const textBody = childElements(shape).find((child) => child.name === 'p:txBody')
    if (textBody) lines.push(...textBodyLines(textBody))
  }
  return lines
}

/**
 * Resolves a notes relationship target relative to `ppt/slides/`. Only a part
 * under `ppt/notesSlides/` is accepted, so a crafted `.rels` cannot point the
 * walker at an arbitrary archive entry.
 */
function resolveNotesPartPath(target: string): string | null {
  const segments = ['ppt', 'slides']
  for (const part of target.split('/')) {
    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else if (part && part !== '.') {
      segments.push(part)
    }
  }
  const path = segments.join('/')
  return path.startsWith(NOTES_PART_PREFIX) && path.endsWith('.xml') ? path : null
}

function notesPartPath(relsXml: string): string | null {
  const document = parseXml(relsXml)
  for (const relationship of findAll(document, 'Relationship')) {
    const type = relationship.attribs.Type ?? ''
    const target = relationship.attribs.Target
    if (target && type.endsWith(NOTES_RELATIONSHIP_SUFFIX)) {
      return resolveNotesPartPath(target)
    }
  }
  return null
}

function slidePartsInOrder(zip: JSZip): Array<{ index: number; path: string }> {
  const slides: Array<{ index: number; path: string }> = []
  for (const path of Object.keys(zip.files)) {
    const match = SLIDE_PART.exec(path)
    if (match) slides.push({ index: Number(match[1]), path })
  }
  return slides.sort((a, b) => a.index - b.index)
}

/**
 * Extracts structured text from a PresentationML package. Slides are separated
 * by a blank line; presenter notes follow their slide under a `[Notes]` marker.
 * The caller must already have applied the archive size guard; each XML part is
 * additionally bounded by {@link readXmlPart}.
 */
export async function extractPresentationText(
  buffer: Buffer,
  options: FileParseOptions = {}
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  options.signal?.throwIfAborted()

  const slideBlocks: string[] = []
  for (const slide of slidePartsInOrder(zip)) {
    const slideXml = await readXmlPart(zip, slide.path)
    options.signal?.throwIfAborted()
    if (slideXml === null) continue

    const blocks = slideBodyBlocks(slideXml)

    const relsXml = await readXmlPart(zip, `ppt/slides/_rels/slide${slide.index}.xml.rels`)
    const notesPath = relsXml ? notesPartPath(relsXml) : null
    const notesXml = notesPath ? await readXmlPart(zip, notesPath) : null
    options.signal?.throwIfAborted()
    if (notesXml) {
      const notes = notesBodyLines(notesXml)
      if (notes.length > 0) blocks.push(NOTES_MARKER, ...notes)
    }

    if (blocks.length > 0) slideBlocks.push(joinBlocks(blocks), '')
  }

  return joinBlocks(slideBlocks)
}
