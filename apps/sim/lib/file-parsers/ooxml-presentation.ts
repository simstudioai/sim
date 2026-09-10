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
 * package. Slides are visited in the order the deck displays them; each shape
 * tree is read in document order, recursing into group shapes; placeholder
 * shapes that only carry layout boilerplate (slide number, date, header,
 * footer) are skipped; tables are rendered row by row; SmartArt and chart text
 * are read from their own parts; and presenter notes contribute only their
 * body placeholder, which is how python-pptx, MarkItDown, and Docling read them.
 *
 * Only the matched XML parts are inflated — media entries are never touched.
 */

const SLIDE_PART = /^ppt\/slides\/slide(\d+)\.xml$/
const SLIDE_PART_ANY = /^ppt\/slides\/[^/]+\.xml$/
const PRESENTATION_PART = 'ppt/presentation.xml'
const PRESENTATION_RELS_PART = 'ppt/_rels/presentation.xml.rels'
const NOTES_RELATIONSHIP_SUFFIX = '/notesSlide'
const DIAGRAM_DATA_RELATIONSHIP_SUFFIX = '/diagramData'
const NOTES_PART_PREFIX = 'ppt/notesSlides/'
const PACKAGE_PREFIX = 'ppt/'
const DIAGRAM_GRAPHIC_URI_SUFFIX = '/diagram'
const CHART_GRAPHIC_URI_SUFFIX = '/chart'

/** Opens and closes the modest chart summary (title, axis titles, series, categories). */
const CHART_OPEN = '[Chart]'
const CHART_CLOSE = '[/Chart]'

type Relationships = Map<string, { type: string; target: string }>

interface SlideContext {
  zip: JSZip
  /** The slide part's own relationships, for diagram, chart, and notes targets. */
  rels: Relationships
  /** Directory the slide's relationship targets resolve against. */
  baseDir: string
}

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

/** Every `<a:t>` run under a node, for chart titles and axis titles. */
function runText(node: XmlElement): string {
  return findAll(node, 'a:t')
    .map((run) => run.children.map((child) => (child.type === 'text' ? child.data : '')).join(''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cached cell values (`c:pt/c:v`) of a chart reference, in index order. */
function cachedValues(node: XmlElement): string[] {
  const values: string[] = []
  for (const point of findAll(node, 'c:pt')) {
    const value = findFirst(point, 'c:v')
    const text = value ? runText(value) || textContent(value) : ''
    if (text) values.push(text)
  }
  return values
}

function textContent(node: XmlElement): string {
  return node.children
    .map((child) => (child.type === 'text' ? child.data : ''))
    .join('')
    .trim()
}

/**
 * SmartArt keeps its text in the diagram data part: one `dgm:pt` per node, each
 * with its own text body, in document order.
 */
function diagramLines(dataXml: string): string[] {
  const lines: string[] = []
  for (const point of findAll(parseXml(dataXml), 'dgm:pt')) {
    const text = textBodyLines(point).join(' ').trim()
    if (text) lines.push(text)
  }
  return lines
}

/**
 * A modest chart summary: the chart title, axis titles, one line per series
 * name, and one line per category (taken from the first series that has any).
 */
function chartLines(chartXml: string): string[] {
  const chart = findFirst(parseXml(chartXml), 'c:chart')
  if (!chart) return []

  const lines: string[] = []
  const title = childElements(chart).find((child) => child.name === 'c:title')
  const titleText = title ? runText(title) : ''
  if (titleText) lines.push(titleText)

  for (const axis of findAll(chart, 'c:catAx').concat(findAll(chart, 'c:valAx'))) {
    const axisTitle = childElements(axis).find((child) => child.name === 'c:title')
    const axisText = axisTitle ? runText(axisTitle) : ''
    if (axisText) lines.push(axisText)
  }

  let categories: string[] = []
  for (const series of findAll(chart, 'c:ser')) {
    const name = childElements(series).find((child) => child.name === 'c:tx')
    const nameText = name ? cachedValues(name).join(' ') || runText(name) : ''
    if (nameText) lines.push(nameText)
    if (categories.length === 0) {
      const category = childElements(series).find((child) => child.name === 'c:cat')
      if (category) categories = cachedValues(category)
    }
  }
  lines.push(...categories)

  return lines.length > 0 ? [CHART_OPEN, ...lines, CHART_CLOSE] : []
}

/**
 * Resolves a relationship target against a directory and clamps it inside
 * `ppt/`, so a crafted `.rels` cannot point the walker at an arbitrary entry.
 */
function resolvePackagePath(baseDir: string, target: string): string | null {
  const segments = baseDir.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '..') {
      if (segments.length === 0) return null
      segments.pop()
    } else if (part && part !== '.') {
      segments.push(part)
    }
  }
  const path = segments.join('/')
  return path.startsWith(PACKAGE_PREFIX) && path.endsWith('.xml') ? path : null
}

function parseRelationships(relsXml: string | null): Relationships {
  const rels: Relationships = new Map()
  if (relsXml === null) return rels
  for (const relationship of findAll(parseXml(relsXml), 'Relationship')) {
    const { Id: id, Type: type, Target: target } = relationship.attribs
    if (id && target) rels.set(id, { type: type ?? '', target })
  }
  return rels
}

function relationshipTarget(context: SlideContext, id: string | undefined): string | null {
  const relationship = id ? context.rels.get(id) : undefined
  return relationship ? resolvePackagePath(context.baseDir, relationship.target) : null
}

function relationshipTargetByType(context: SlideContext, typeSuffix: string): string | null {
  for (const relationship of context.rels.values()) {
    if (relationship.type.endsWith(typeSuffix)) {
      return resolvePackagePath(context.baseDir, relationship.target)
    }
  }
  return null
}

/** The `r:dm` data-model relationship, falling back to the slide's only diagram-data part. */
function diagramDataPath(context: SlideContext, graphicData: XmlElement): string | null {
  const relIds = findFirst(graphicData, 'dgm:relIds')
  return (
    relationshipTarget(context, relIds?.attribs['r:dm']) ??
    relationshipTargetByType(context, DIAGRAM_DATA_RELATIONSHIP_SUFFIX)
  )
}

/** Tables inline; SmartArt and charts live in their own parts, reached through the slide rels. */
async function graphicFrameBlocks(context: SlideContext, frame: XmlElement): Promise<string[]> {
  const table = findFirst(frame, 'a:tbl')
  if (table) return tableBlocks(table)

  const graphicData = findFirst(frame, 'a:graphicData')
  if (!graphicData) return []
  const uri = graphicData.attribs.uri ?? ''

  if (uri.endsWith(DIAGRAM_GRAPHIC_URI_SUFFIX)) {
    const path = diagramDataPath(context, graphicData)
    const xml = path ? await readXmlPart(context.zip, path) : null
    return xml ? diagramLines(xml) : []
  }

  if (uri.endsWith(CHART_GRAPHIC_URI_SUFFIX)) {
    const chart = findFirst(graphicData, 'c:chart')
    const path = relationshipTarget(context, chart?.attribs['r:id'])
    const xml = path ? await readXmlPart(context.zip, path) : null
    return xml ? chartLines(xml) : []
  }

  return []
}

/** A connector can carry a text body; it reads like any other shape's text. */
function connectorBlocks(connector: XmlElement): string[] {
  const textBody = childElements(connector).find((child) => child.name === 'p:txBody')
  if (!textBody) return []
  const lines = textBodyLines(textBody)
  return lines.length > 0 ? [lines.join('\n')] : []
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
async function shapeTreeBlocks(context: SlideContext, tree: XmlElement): Promise<string[]> {
  const blocks: string[] = []
  for (const child of childElements(tree)) {
    switch (child.name) {
      case 'p:sp':
        blocks.push(...shapeBlocks(child))
        break
      case 'p:cxnSp':
        blocks.push(...connectorBlocks(child))
        break
      case 'p:grpSp':
        blocks.push(...(await shapeTreeBlocks(context, child)))
        break
      case 'p:graphicFrame':
        blocks.push(...(await graphicFrameBlocks(context, child)))
        break
      case 'p:pic':
        blocks.push(...pictureBlocks(child))
        break
      case 'mc:AlternateContent': {
        const branch = alternateContentBranch(child)
        if (branch) blocks.push(...(await shapeTreeBlocks(context, branch)))
        break
      }
      default:
        break
    }
  }
  return blocks
}

async function slideBodyBlocks(context: SlideContext, slideXml: string): Promise<string[]> {
  const document = parseXml(slideXml)
  const tree = findFirst(document, 'p:spTree')
  return tree ? shapeTreeBlocks(context, tree) : []
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

/** The slide's notes part, accepted only under `ppt/notesSlides/`. */
function notesPartPath(context: SlideContext): string | null {
  const path = relationshipTargetByType(context, NOTES_RELATIONSHIP_SUFFIX)
  return path?.startsWith(NOTES_PART_PREFIX) ? path : null
}

/** Physical part order — the fallback when the presentation part cannot say. */
function slidePartsByNumber(zip: JSZip): string[] {
  const slides: Array<{ index: number; path: string }> = []
  for (const path of Object.keys(zip.files)) {
    const match = SLIDE_PART.exec(path)
    if (match) slides.push({ index: Number(match[1]), path })
  }
  return slides.sort((a, b) => a.index - b.index).map((slide) => slide.path)
}

/**
 * The order the deck displays: `p:sldIdLst` in `ppt/presentation.xml`, each id
 * resolved through the presentation's relationships. Reordering slides in
 * PowerPoint changes this list, not the part names. Ids whose target is missing
 * are skipped; when nothing resolves, the physical order is used instead.
 */
async function slidePartsInOrder(zip: JSZip): Promise<string[]> {
  const presentationXml = await readXmlPart(zip, PRESENTATION_PART)
  const relsXml = await readXmlPart(zip, PRESENTATION_RELS_PART)
  if (presentationXml === null || relsXml === null) return slidePartsByNumber(zip)

  const rels = parseRelationships(relsXml)
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const slideId of findAll(parseXml(presentationXml), 'p:sldId')) {
    const relationship = rels.get(slideId.attribs['r:id'] ?? '')
    const path = relationship ? resolvePackagePath(PACKAGE_PREFIX, relationship.target) : null
    if (!path || !SLIDE_PART_ANY.test(path) || seen.has(path) || !zip.file(path)) continue
    seen.add(path)
    ordered.push(path)
  }
  return ordered.length > 0 ? ordered : slidePartsByNumber(zip)
}

function slideRelsPath(slidePath: string): string {
  const slash = slidePath.lastIndexOf('/')
  return `${slidePath.slice(0, slash)}/_rels/${slidePath.slice(slash + 1)}.rels`
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
  for (const slidePath of await slidePartsInOrder(zip)) {
    const slideXml = await readXmlPart(zip, slidePath)
    options.signal?.throwIfAborted()
    if (slideXml === null) continue

    const context: SlideContext = {
      zip,
      rels: parseRelationships(await readXmlPart(zip, slideRelsPath(slidePath))),
      baseDir: slidePath.slice(0, slidePath.lastIndexOf('/')),
    }
    const blocks = await slideBodyBlocks(context, slideXml)
    options.signal?.throwIfAborted()

    const notesPath = notesPartPath(context)
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
