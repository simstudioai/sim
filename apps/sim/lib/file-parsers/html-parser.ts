import { readFile } from 'fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as cheerio from 'cheerio'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { decodeTextBuffer, sanitizeTextForUTF8 } from '@/lib/file-parsers/utils'

const logger = createLogger('HtmlParser')

/**
 * Bounds the DOM tree, which costs ~500 bytes per markup token (`<`) on cheerio
 * 1.1.2: measured at 0.2M/1M/2M tokens as 101/504/1008 MB retained, linear
 * across all three.
 *
 * A 50,000-row by 8-column table export is ~900k tokens in only 8.7 MB, so a
 * tighter cap rejects ordinary exports; 999k tokens in a 10 MB body parses
 * inside a 2 GB heap.
 */
const MAX_HTML_MARKUP_TOKENS = 1_000_000

/**
 * Bounds the body, which governs peak memory: extraction materialises the text
 * several times over (UTF-16 buffer copy, per-node strings, the joined output).
 *
 * Measured against a 2 GB heap with the token cap saturated: 32 MB parses,
 * 48 MB parses, 64 MB aborts the process. Deliberately NOT raised to the
 * shared 100 MB document limit — that limit governs what may be uploaded, and
 * a 100 MB body aborts here even with few tokens. Any change to this number
 * needs the same abort test, not a consistency argument.
 */
const MAX_HTML_INPUT_BYTES = 32 * 1024 * 1024

const MARKUP_TOKEN_BYTE = 0x3c

/**
 * Raised when a document exceeds the limits above, so an input rejected on
 * resource grounds is not reported as a malformed file.
 */
export class HtmlComplexityError extends FileParserError {
  constructor(message: string) {
    super('complexity_limit', message)
    this.name = 'HtmlComplexityError'
  }
}

export function isHtmlComplexityError(error: unknown): error is HtmlComplexityError {
  return error instanceof HtmlComplexityError
}

function exceedsMarkupTokenLimit(buffer: Buffer): boolean {
  let count = 0
  let index = buffer.indexOf(MARKUP_TOKEN_BYTE)

  while (index !== -1) {
    if (++count > MAX_HTML_MARKUP_TOKENS) return true
    index = buffer.indexOf(MARKUP_TOKEN_BYTE, index + 1)
  }

  return false
}

/**
 * `cheerio.load` builds the entire parse5 tree before returning, so an outsized
 * document has to be rejected on the buffer, before the string copy.
 */
function assertHtmlWithinLimits(buffer: Buffer): void {
  if (buffer.length > MAX_HTML_INPUT_BYTES) {
    throw new HtmlComplexityError(
      `HTML document is ${buffer.length} bytes, above the maximum of ${MAX_HTML_INPUT_BYTES} bytes`
    )
  }

  if (exceedsMarkupTokenLimit(buffer)) {
    throw new HtmlComplexityError(
      `HTML document exceeds the maximum of ${MAX_HTML_MARKUP_TOKENS} markup tokens`
    )
  }
}

/**
 * The same caps for HTML that already exists as a string — markup another
 * converter produced in memory (mammoth's DOCX rendering) — measured without
 * copying it into a buffer.
 */
export function assertHtmlStringWithinLimits(html: string): void {
  const byteLength = Buffer.byteLength(html, 'utf8')
  if (byteLength > MAX_HTML_INPUT_BYTES) {
    throw new HtmlComplexityError(
      `HTML document is ${byteLength} bytes, above the maximum of ${MAX_HTML_INPUT_BYTES} bytes`
    )
  }

  let count = 0
  let index = html.indexOf('<')
  while (index !== -1) {
    if (++count > MAX_HTML_MARKUP_TOKENS) {
      throw new HtmlComplexityError(
        `HTML document exceeds the maximum of ${MAX_HTML_MARKUP_TOKENS} markup tokens`
      )
    }
    index = html.indexOf('<', index + 1)
  }
}

const NON_CONTENT_SELECTOR = 'script, style, noscript, meta, link, iframe, object, embed, svg'

/** Block elements inside a table cell; `.text()` would otherwise glue their words together. */
const CELL_BLOCK_SELECTOR = 'p, div, li, br, h1, h2, h3, h4, h5, h6, tr'

/** mammoth renders a footnote's return link as `<a href="#footnote-ref-N">↑</a>`. */
const FOOTNOTE_BACKLINK_SELECTOR = 'a[href^="#footnote-ref"]'

/**
 * Strips the non-content markup and HTML comments from a loaded document so the
 * structured walk sees only what a reader would.
 */
function stripNonContent($: cheerio.CheerioAPI): void {
  $(NON_CONTENT_SELECTOR).remove()
  $(FOOTNOTE_BACKLINK_SELECTOR).remove()

  $.root()
    .contents()
    .filter(function () {
      return this.type === 'comment'
    })
    .remove()
}

/**
 * Converts an HTML document into structured plain text: headings and paragraphs
 * on their own lines, `•`/`1.` list markers with nesting indents, and tables as
 * `[Table]` / `| a | b |` / `[/Table]` rows. Shared by {@link HtmlParser} and the
 * DOCX parser, which routes mammoth's HTML rendering through the same walk so
 * both formats produce the same shape.
 */
export function htmlToStructuredText(html: string): string {
  const $ = cheerio.load(html)
  stripNonContent($)
  return extractStructuredText($)
}

function extractStructuredText($: cheerio.CheerioAPI): string {
  const contentParts: string[] = []

  const rootElement = $('body').length > 0 ? $('body') : $.root()

  processElement($, rootElement, contentParts, 0)

  return contentParts.join('\n').trim()
}

type AnyNode = ReturnType<cheerio.Cheerio<never>['contents']> extends cheerio.Cheerio<infer N>
  ? N
  : never

type ElementNode = Extract<AnyNode, { tagName: string }>

function isTagNode(node: AnyNode): node is ElementNode {
  return node.type === 'tag'
}

/**
 * Recursively process elements to extract text with structure
 */
function processElement(
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<AnyNode>,
  contentParts: string[],
  depth: number
): void {
  element.contents().each((_, node) => {
    if (node.type === 'text') {
      const text = $(node).text().trim()
      if (text) {
        contentParts.push(text)
      }
      return
    }

    if (!isTagNode(node)) return

    const $node = $(node)
    const tagName = node.tagName.toLowerCase()

    switch (tagName) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const headingText = $node.text().trim()
        if (headingText) {
          contentParts.push(`\n${headingText}\n`)
        }
        break
      }

      case 'p': {
        const paragraphText = $node.text().trim()
        if (paragraphText) {
          contentParts.push(`${paragraphText}\n`)
        }
        break
      }

      case 'br':
        contentParts.push('\n')
        break

      case 'hr':
        contentParts.push('\n---\n')
        break

      case 'li':
        processListItem($, $node, contentParts, depth, null)
        break

      case 'ul':
      case 'ol':
        contentParts.push('\n')
        processList($, $node, contentParts, depth + 1, tagName === 'ol')
        contentParts.push('\n')
        break

      case 'table':
        processTable($, $node, contentParts)
        break

      case 'blockquote': {
        const quoteText = $node.text().trim()
        if (quoteText) {
          contentParts.push(`\n> ${quoteText}\n`)
        }
        break
      }

      case 'pre':
      case 'code': {
        const codeText = $node.text().trim()
        if (codeText) {
          contentParts.push(`\n\`\`\`\n${codeText}\n\`\`\`\n`)
        }
        break
      }

      case 'a': {
        const linkText = $node.text().trim()
        const href = $node.attr('href')
        if (linkText) {
          if (href?.startsWith('http')) {
            contentParts.push(`${linkText} (${href})`)
          } else {
            contentParts.push(linkText)
          }
        }
        break
      }

      case 'img': {
        const alt = $node.attr('alt')
        if (alt) {
          contentParts.push(`[Image: ${alt}]`)
        }
        break
      }

      default:
        processElement($, $node, contentParts, depth)
    }
  })
}

/**
 * Walks a list's children, numbering `<ol>` items from its `start` attribute and
 * bulleting `<ul>` items. Non-item children are walked as ordinary content.
 */
function processList(
  $: cheerio.CheerioAPI,
  list: cheerio.Cheerio<AnyNode>,
  contentParts: string[],
  depth: number,
  ordered: boolean
): void {
  const start = Number.parseInt(list.attr('start') ?? '1', 10)
  let index = Number.isFinite(start) ? start : 1

  list.children().each((_, child) => {
    const $child = $(child)
    if (isTagNode(child) && child.tagName.toLowerCase() === 'li') {
      processListItem($, $child, contentParts, depth, ordered ? index++ : null)
    } else {
      processElement($, $child, contentParts, depth)
    }
  })
}

/**
 * Emits a list item as one marked line built from its own inline text, then
 * walks any nested lists so their items keep their own markers and indent.
 */
function processListItem(
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
  contentParts: string[],
  depth: number,
  ordinal: number | null
): void {
  const ownText: string[] = []
  const nestedLists: cheerio.Cheerio<AnyNode>[] = []

  item.contents().each((_, child) => {
    if (isTagNode(child)) {
      const childTag = child.tagName.toLowerCase()
      if (childTag === 'ul' || childTag === 'ol') {
        nestedLists.push($(child))
        return
      }
    }
    const text = $(child).text().replace(/\s+/g, ' ').trim()
    if (text) ownText.push(text)
  })

  const itemText = ownText.join(' ').trim()
  if (itemText) {
    const indent = '  '.repeat(Math.min(Math.max(depth - 1, 0), 3))
    const marker = ordinal === null ? '•' : `${ordinal}.`
    contentParts.push(`${indent}${marker} ${itemText}`)
  }

  for (const nested of nestedLists) {
    const nestedTag = nested.prop('tagName')?.toLowerCase()
    processList($, nested, contentParts, depth + 1, nestedTag === 'ol')
  }
}

/**
 * Process table elements to extract structured data
 */
function processTable(
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<AnyNode>,
  contentParts: string[]
): void {
  contentParts.push('\n[Table]')

  table.find('tr').each((_, row) => {
    const $row = $(row)
    const cells: string[] = []

    $row.find('td, th').each((_, cell) => {
      const $cell = $(cell)
      $cell.find(CELL_BLOCK_SELECTOR).after(' ')
      const cellText = $cell.text().replace(/\s+/g, ' ').trim()
      cells.push(cellText || '')
    })

    if (cells.length > 0) {
      contentParts.push(`| ${cells.join(' | ')} |`)
    }
  })

  contentParts.push('[/Table]\n')
}

export class HtmlParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    let buffer: Buffer

    /** Scoped to the read alone so `parseBuffer`'s typed rejections reach callers intact. */
    try {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      buffer = await readFile(filePath)
    } catch (error) {
      logger.error('HTML file error:', error)
      throw new Error(`Failed to parse HTML file: ${getErrorMessage(error, 'Unknown error')}`)
    }

    return this.parseBuffer(buffer)
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    if (!buffer || buffer.length === 0) {
      throw new FileParserError('empty_input', 'Empty buffer provided')
    }

    assertHtmlWithinLimits(buffer)

    try {
      logger.info('Parsing HTML buffer, size:', buffer.length)

      const decoded = decodeTextBuffer(buffer)
      const htmlContent = decoded.text
      const $ = cheerio.load(htmlContent)

      // Extract meta information before removing tags
      const title = $('title').text().trim()
      const metaDescription = $('meta[name="description"]').attr('content') || ''

      stripNonContent($)

      const content = extractStructuredText($)

      const sanitizedContent = sanitizeTextForUTF8(content)

      const characterCount = sanitizedContent.length
      const wordCount = sanitizedContent.split(/\s+/).filter((word) => word.length > 0).length
      const estimatedTokenCount = Math.ceil(characterCount / 4)

      const headings = this.extractHeadings($)

      const links = this.extractLinks($)

      return {
        content: sanitizedContent,
        metadata: {
          title,
          metaDescription,
          characterCount,
          wordCount,
          tokenCount: estimatedTokenCount,
          headings,
          links: links.slice(0, 50),
          hasImages: $('img').length > 0,
          imageCount: $('img').length,
          encoding: decoded.encoding,
          warning: decoded.warning,
          hasTable: $('table').length > 0,
          tableCount: $('table').length,
          hasList: $('ul, ol').length > 0,
          listCount: $('ul, ol').length,
        },
      }
    } catch (error) {
      /**
       * Every `RangeError` reachable here is resource exhaustion the pre-parse
       * caps cannot predict: a stack overflow inside cheerio's recursive
       * `.text()` on deeply nested markup, or an over-long string from joining
       * the extracted parts. Both must stay fail-closed rather than degrade to
       * the route's raw-text fallback.
       */
      if (error instanceof RangeError) {
        logger.warn('HTML document exhausted parser resources:', error)
        throw new HtmlComplexityError(
          `HTML document could not be extracted within resource limits: ${error.message}`
        )
      }

      logger.error('HTML buffer parsing error:', error)
      throw new FileParserError(
        'invalid_format',
        `Failed to parse HTML buffer: ${getErrorMessage(error, 'Unknown error')}`,
        error
      )
    }
  }

  /**
   * Extract heading structure for metadata
   */
  private extractHeadings($: cheerio.CheerioAPI): Array<{ level: number; text: string }> {
    const headings: Array<{ level: number; text: string }> = []

    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $element = $(element)
      const tagName = element.tagName?.toLowerCase()
      const level = Number.parseInt(tagName?.charAt(1) || '1', 10)
      const text = $element.text().trim()

      if (text) {
        headings.push({ level, text })
      }
    })

    return headings
  }

  /**
   * Extract links from the document
   */
  private extractLinks($: cheerio.CheerioAPI): Array<{ text: string; href: string }> {
    const links: Array<{ text: string; href: string }> = []

    $('a[href]').each((_, element) => {
      const $element = $(element)
      const href = $element.attr('href')
      const text = $element.text().trim()

      if (href && text && href.startsWith('http')) {
        links.push({ text, href })
      }
    })

    return links
  }
}
