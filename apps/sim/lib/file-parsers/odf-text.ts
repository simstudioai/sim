import JSZip from 'jszip'
import { FileParserError } from '@/lib/file-parsers/errors'
import {
  childElements,
  collapseWhitespace,
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
 * Structured text extraction for OpenDocument text and presentation packages
 * (`.odt`, `.odp`) that walks `content.xml` in document order. Headings and
 * paragraphs become lines, lists get `•` markers with nesting indents, tables
 * are rendered row by row, footnotes are appended after their paragraph, and
 * reviewer annotations plus tracked deletions are dropped the way pandoc,
 * odfpy, and LibreOffice's own text export drop them.
 *
 * Only `content.xml` and embedded `Object N/content.xml` parts are inflated.
 */

const CONTENT_PART = 'content.xml'
const EMBEDDED_CONTENT_PART = /^Object (\d+)\/content\.xml$/

/** Subtrees whose text is review metadata rather than document content. */
const SKIPPED_SUBTREES = new Set([
  'office:annotation',
  'office:annotation-end',
  'text:tracked-changes',
  'office:change-info',
  'text:sequence-decls',
  'text:variable-decls',
  'text:user-field-decls',
  'office:forms',
])

/** Presentation frames that render layout chrome rather than slide content. */
const SKIPPED_PRESENTATION_CLASSES = new Set(['header', 'footer', 'date-time', 'page-number'])

/** Bounds `table:number-columns-repeated`, which spreadsheets inflate to 1024. */
const MAX_REPEATED_COLUMNS = 32

const MAX_LIST_INDENT = 3

interface WalkState {
  blocks: string[]
  /** Footnote bodies gathered while rendering the current paragraph. */
  pendingNotes: string[]
  /** Inside a table cell, nested tables flatten to text rather than emitting markers. */
  inCell: boolean
}

function newState(inCell = false): WalkState {
  return { blocks: [], pendingNotes: [], inCell }
}

function isSkipped(element: XmlElement): boolean {
  if (SKIPPED_SUBTREES.has(element.name)) return true
  if (element.name === 'draw:frame') {
    const presentationClass = element.attribs['presentation:class']
    return presentationClass !== undefined && SKIPPED_PRESENTATION_CLASSES.has(presentationClass)
  }
  return false
}

/**
 * Inline text of a paragraph-like element, expanding ODF whitespace elements and
 * collecting footnote bodies into `state.pendingNotes`.
 */
function inlineText(element: XmlElement, state: WalkState): string {
  const pieces: string[] = []
  for (const child of element.children) {
    if (child.type === 'text') {
      pieces.push(child.data)
      continue
    }
    if (!isXmlElement(child) || isSkipped(child)) continue

    switch (child.name) {
      case 'text:s': {
        const count = Number.parseInt(child.attribs['text:c'] ?? '1', 10)
        pieces.push(' '.repeat(Number.isFinite(count) && count > 0 ? count : 1))
        break
      }
      case 'text:tab':
        pieces.push('\t')
        break
      case 'text:line-break':
        pieces.push('\n')
        break
      case 'draw:frame': {
        const image = imageFrameText(child, state)
        pieces.push(image === null ? inlineText(child, state) : image)
        break
      }
      case 'text:note': {
        const citation = findFirst(child, 'text:note-citation')
        const body = findFirst(child, 'text:note-body')
        const label = citation ? collapseWhitespace(inlineText(citation, state)) : ''
        const bodyText = body ? collapseWhitespace(blockText(body)) : ''
        if (label) pieces.push(`[${label}]`)
        if (bodyText) state.pendingNotes.push(label ? `[${label}] ${bodyText}` : bodyText)
        break
      }
      default:
        pieces.push(inlineText(child, state))
    }
  }
  return pieces.join('')
}

/** Renders a container's block children to a single string, for cells and note bodies. */
function blockText(container: XmlElement, inCell = false): string {
  const state = newState(inCell)
  walkChildren(container, state, 0)
  return [...state.blocks, ...state.pendingNotes].join('\n')
}

function flushNotes(state: WalkState): void {
  if (state.pendingNotes.length === 0) return
  state.blocks.push(...state.pendingNotes)
  state.pendingNotes = []
}

function emitParagraph(element: XmlElement, state: WalkState, heading: boolean): void {
  const text = inlineText(element, state)
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  if (text) {
    state.blocks.push(heading ? `\n${text}\n` : text)
  }
  flushNotes(state)
  if (text) state.blocks.push('')
}

function emitList(list: XmlElement, state: WalkState, depth: number): void {
  const indent = '  '.repeat(Math.min(depth, MAX_LIST_INDENT))
  for (const item of childElements(list)) {
    if (item.name !== 'text:list-item' && item.name !== 'text:list-header') continue
    let markerPending = item.name === 'text:list-item'
    for (const child of childElements(item)) {
      if (isSkipped(child)) continue
      if (child.name === 'text:list') {
        emitList(child, state, depth + 1)
        continue
      }
      if (child.name === 'text:p' || child.name === 'text:h') {
        const text = collapseWhitespace(inlineText(child, state))
        if (text) {
          state.blocks.push(markerPending ? `${indent}• ${text}` : `${indent}  ${text}`)
          markerPending = false
        }
        flushNotes(state)
        continue
      }
      walkElement(child, state, depth + 1)
    }
  }
}

function cellText(cell: XmlElement): string {
  return collapseWhitespace(blockText(cell, true))
}

function repeatCount(element: XmlElement, attribute: string, cap: number): number {
  const raw = element.attribs[attribute]
  if (raw === undefined) return 1
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, cap)
}

function tableRows(container: XmlElement, rows: string[]): void {
  for (const child of childElements(container)) {
    if (isSkipped(child)) continue
    switch (child.name) {
      case 'table:table-row': {
        const cells: string[] = []
        for (const cell of childElements(child)) {
          if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue
          const text = cellText(cell)
          const repeats = repeatCount(cell, 'table:number-columns-repeated', MAX_REPEATED_COLUMNS)
          for (let i = 0; i < repeats; i++) cells.push(text)
        }
        if (cells.some((cell) => cell.length > 0)) rows.push(formatTableRow(cells))
        break
      }
      case 'table:table-header-rows':
      case 'table:table-rows':
      case 'table:table-row-group':
        tableRows(child, rows)
        break
      default:
        break
    }
  }
}

/** Every non-empty cell of a table in reading order, for a table nested inside a cell. */
function flattenedCells(container: XmlElement, cells: string[]): void {
  for (const child of childElements(container)) {
    if (isSkipped(child)) continue
    if (child.name === 'table:table-row') {
      for (const cell of childElements(child)) {
        if (cell.name !== 'table:table-cell' && cell.name !== 'table:covered-table-cell') continue
        const text = cellText(cell)
        if (text) cells.push(text)
      }
    } else if (
      child.name === 'table:table-header-rows' ||
      child.name === 'table:table-rows' ||
      child.name === 'table:table-row-group'
    ) {
      flattenedCells(child, cells)
    }
  }
}

function emitTable(table: XmlElement, state: WalkState): void {
  if (state.inCell) {
    const cells: string[] = []
    flattenedCells(table, cells)
    if (cells.length > 0) state.blocks.push(cells.join(' / '))
    return
  }
  const rows: string[] = []
  tableRows(table, rows)
  if (rows.length > 0) {
    state.blocks.push('', TABLE_OPEN, ...rows, TABLE_CLOSE, '')
  }
}

/**
 * A frame holding an image contributes its alternative text, as `<img alt>`
 * does in HTML. Returns `null` for a frame that is not an image (a text box).
 */
function imageFrameText(frame: XmlElement, state: WalkState): string | null {
  const children = childElements(frame)
  if (!children.some((child) => child.name === 'draw:image')) return null
  const alt = children.find((child) => child.name === 'svg:title' || child.name === 'svg:desc')
  return alt ? (imageAltText(inlineText(alt, state)) ?? '') : ''
}

function emitNotes(notes: XmlElement, state: WalkState): void {
  const body = collapseWhitespace(blockText(notes))
  if (body) state.blocks.push(NOTES_MARKER, body)
}

function walkElement(element: XmlElement, state: WalkState, depth: number): void {
  if (isSkipped(element)) return

  switch (element.name) {
    case 'text:h':
      emitParagraph(element, state, true)
      break
    case 'text:p':
      emitParagraph(element, state, false)
      break
    case 'text:list':
      emitList(element, state, depth)
      if (depth === 0) state.blocks.push('')
      break
    case 'draw:frame': {
      const image = imageFrameText(element, state)
      if (image === null) {
        walkChildren(element, state, depth)
      } else if (image) {
        state.blocks.push(image)
      }
      break
    }
    case 'table:table':
      emitTable(element, state)
      break
    case 'presentation:notes':
      emitNotes(element, state)
      break
    case 'draw:page':
      walkChildren(element, state, depth)
      state.blocks.push('')
      break
    default:
      walkChildren(element, state, depth)
  }
}

function walkChildren(container: XmlElement, state: WalkState, depth: number): void {
  for (const child of childElements(container)) {
    walkElement(child, state, depth)
  }
}

function contentBlocks(contentXml: string): string[] {
  const document = parseXml(contentXml)
  const body = findFirst(document, 'office:body')
  if (!body) return []
  const state = newState()
  walkChildren(body, state, 0)
  flushNotes(state)
  return state.blocks
}

function embeddedContentParts(zip: JSZip): string[] {
  const parts: Array<{ index: number; path: string }> = []
  for (const path of Object.keys(zip.files)) {
    const match = EMBEDDED_CONTENT_PART.exec(path)
    if (match) parts.push({ index: Number(match[1]), path })
  }
  return parts.sort((a, b) => a.index - b.index).map((part) => part.path)
}

/**
 * Extracts structured text from an OpenDocument text or presentation package.
 * The caller must already have applied the archive size guard; each XML part is
 * additionally bounded by {@link readXmlPart}. An archive without `content.xml`
 * is not an OpenDocument file at all and is rejected as `invalid_format`; a
 * present but textless body yields an empty string for the caller to classify.
 */
export async function extractOpenDocumentText(
  buffer: Buffer,
  options: FileParseOptions = {}
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  options.signal?.throwIfAborted()

  if (!zip.file(CONTENT_PART)) {
    throw new FileParserError(
      'invalid_format',
      'The archive has no content.xml, so it is not an OpenDocument file'
    )
  }

  const sections: string[] = []
  for (const path of [CONTENT_PART, ...embeddedContentParts(zip)]) {
    const xml = await readXmlPart(zip, path)
    options.signal?.throwIfAborted()
    if (xml === null) continue
    const blocks = contentBlocks(xml)
    if (blocks.length > 0) sections.push(joinBlocks(blocks), '')
  }

  return joinBlocks(sections)
}
