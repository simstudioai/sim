import { DomUtils, parseDocument } from 'htmlparser2'
import type JSZip from 'jszip'
import type { JSZipObject } from 'jszip'
import { FileParserError } from '@/lib/file-parsers/errors'

/**
 * Shared XML primitives for the OOXML and OpenDocument structured-text walkers.
 * Both formats are ZIP archives of namespaced XML parts; htmlparser2 in XML mode
 * keeps the `prefix:local` tag names verbatim, so the walkers match on them
 * directly without a namespace-aware parser.
 */

export type XmlDocument = ReturnType<typeof parseDocument>
export type XmlNode = XmlDocument['children'][number]
export type XmlElement = Extract<XmlNode, { tagName: string }>

/** Opens a structured table block in walker output. */
export const TABLE_OPEN = '[Table]'

/** Closes a structured table block in walker output. */
export const TABLE_CLOSE = '[/Table]'

/** Introduces presenter notes that follow a slide's body text. */
export const NOTES_MARKER = '[Notes]'

/**
 * Bounds a single XML part before it is parsed. htmlparser2 retains roughly
 * 25 bytes of DOM per byte of markup, so the archive guard's 64 MB entry cap
 * alone would let one slide or `content.xml` part cost over a gigabyte.
 */
export const MAX_OFFICE_XML_PART_BYTES = 16 * 1024 * 1024

function declaredUncompressedSize(entry: JSZipObject): number | undefined {
  const data = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data
  const size = data?.uncompressedSize
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined
}

/**
 * Hard ceiling on the text a walker assembles from one document. The part cap
 * bounds the markup, but ODF whitespace and repeat attributes can expand a
 * small part many times over, so the output is bounded on its own.
 */
export const MAX_OFFICE_TEXT_BYTES = MAX_OFFICE_XML_PART_BYTES

/** Running total of emitted text, shared by every walk state of one document. */
export interface TextBudget {
  used: number
}

export function chargeTextBudget(budget: TextBudget, length: number): void {
  budget.used += length
  if (budget.used > MAX_OFFICE_TEXT_BYTES) {
    throw new FileParserError(
      'complexity_limit',
      `Document text exceeds the maximum of ${MAX_OFFICE_TEXT_BYTES} bytes`
    )
  }
}

/** The assembled output must fit the same ceiling once joined. */
export function assertTextWithinLimit(text: string): string {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > MAX_OFFICE_TEXT_BYTES) {
    throw new FileParserError(
      'complexity_limit',
      `Document text is ${bytes} bytes, above the maximum of ${MAX_OFFICE_TEXT_BYTES} bytes`
    )
  }
  return text
}

function xmlPartTooLarge(path: string, bytes: number): FileParserError {
  return new FileParserError(
    'complexity_limit',
    `Document part ${path} is ${bytes} bytes, above the maximum of ${MAX_OFFICE_XML_PART_BYTES} bytes`
  )
}

/**
 * Inflates one XML part as a string, or returns `null` when the archive has no
 * such entry. Rejects a part above {@link MAX_OFFICE_XML_PART_BYTES} on its
 * declared size before inflating, and on its real size afterwards in case the
 * declaration lied.
 */
export async function readXmlPart(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path)
  if (!entry) return null

  const declared = declaredUncompressedSize(entry)
  if (declared !== undefined && declared > MAX_OFFICE_XML_PART_BYTES) {
    throw xmlPartTooLarge(path, declared)
  }

  const xml = await entry.async('string')
  const actual = Buffer.byteLength(xml, 'utf8')
  if (actual > MAX_OFFICE_XML_PART_BYTES) throw xmlPartTooLarge(path, actual)
  return xml
}

export function parseXml(xml: string): XmlDocument {
  return parseDocument(xml, { xmlMode: true })
}

export function isXmlElement(node: XmlNode): node is XmlElement {
  return node.type === 'tag'
}

/** Direct element children in document order. */
export function childElements(node: XmlDocument | XmlElement): XmlElement[] {
  return node.children.filter(isXmlElement)
}

/** First descendant (or the node itself) with the given tag name, in document order. */
export function findFirst(node: XmlDocument | XmlElement, tagName: string): XmlElement | null {
  const found = DomUtils.findOne((element) => element.name === tagName, node.children, true)
  return found ?? null
}

/** Every descendant with the given tag name, in document order. */
export function findAll(node: XmlDocument | XmlElement, tagName: string): XmlElement[] {
  return DomUtils.findAll((element) => element.name === tagName, node.children)
}

/** A bare file name (`python-logo.gif`) rather than a description. */
const FILENAME_LIKE = /^[^\s]+\.[a-z0-9]{2,4}$/i

/** Auto-generated captions that name the object, not its content (`Picture 3`). */
const AUTO_CAPTION = /^(?:picture|image|graphic|photo|figure|chart|diagram|screenshot)\s*\d*$/i

/**
 * Renders an image's alternative text as `[Image: …]`, or `null` when the text
 * is a file name or an auto-generated caption, which would only add noise.
 */
export function imageAltText(raw: string | undefined): string | null {
  const text = raw ? collapseWhitespace(raw) : ''
  if (!text || FILENAME_LIKE.test(text) || AUTO_CAPTION.test(text)) return null
  return `[Image: ${text}]`
}

/**
 * Strips trailing spaces and tabs from every line in linear time. The obvious
 * `/[ \t]+\n/` is quadratic on a long whitespace run — each position scans
 * the run, fails on the newline, and backtracks — which a document inside the
 * text budget can still trigger.
 */
export function trimLineEnds(text: string): string {
  return text.includes('\n')
    ? text
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
    : text
}

/** Collapses internal whitespace so a cell or list item occupies a single line. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Renders one table row in the `| a | b |` shape the HTML walker produces. */
export function formatTableRow(cells: string[]): string {
  return `| ${cells.map(collapseWhitespace).join(' | ')} |`
}

/**
 * Joins emitted blocks with single newlines and squeezes runs of blank lines to
 * one, so walker output reads like the HTML walker's.
 */
export function joinBlocks(blocks: string[]): string {
  return blocks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
