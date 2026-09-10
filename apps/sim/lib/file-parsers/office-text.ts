import { DomUtils, parseDocument } from 'htmlparser2'

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
