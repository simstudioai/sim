import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import JSZip from 'jszip'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { assertOoxmlArchiveWithinLimits } from '@/lib/file-parsers/zip-guard'

/** MIME type Microsoft Graph reports for `.docx` drive items. */
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Path of the main document part inside a WordprocessingML package. */
const DOCUMENT_PART_PATH = 'word/document.xml'

interface ContentRun {
  text: string
  bold: boolean
  italic: boolean
}

type BlockKind = 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'paragraph'

interface ContentBlock {
  kind: BlockKind
  runs: ContentRun[]
}

const HEADING_LEVEL_BY_KIND = {
  heading1: HeadingLevel.HEADING_1,
  heading2: HeadingLevel.HEADING_2,
  heading3: HeadingLevel.HEADING_3,
} as const

const INLINE_EMPHASIS_PATTERN = /\*\*([^*]+)\*\*|\*([^*]+)\*/g

/** Characters XML 1.0 forbids in a text node. */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

/** Removes the characters XML 1.0 forbids in a text node. */
function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '')
}

/**
 * Splits a line into bold / italic runs using the Markdown subset Sim supports:
 * `**bold**` and `*italic*`. Anything else is emitted verbatim, so unmatched
 * asterisks survive as literal text rather than silently swallowing content.
 */
function parseInlineRuns(line: string): ContentRun[] {
  const runs: ContentRun[] = []
  INLINE_EMPHASIS_PATTERN.lastIndex = 0
  let cursor = 0

  for (
    let match = INLINE_EMPHASIS_PATTERN.exec(line);
    match !== null;
    match = INLINE_EMPHASIS_PATTERN.exec(line)
  ) {
    if (match.index > cursor) {
      runs.push({ text: line.slice(cursor, match.index), bold: false, italic: false })
    }
    if (match[1] !== undefined) {
      runs.push({ text: match[1], bold: true, italic: false })
    } else {
      runs.push({ text: match[2], bold: false, italic: true })
    }
    cursor = match.index + match[0].length
  }

  if (cursor < line.length) {
    runs.push({ text: line.slice(cursor), bold: false, italic: false })
  }

  return runs.length > 0 ? runs : [{ text: '', bold: false, italic: false }]
}

/**
 * Parses text into document blocks using a deliberately small Markdown subset:
 * `# ` / `## ` / `### ` headings, `- ` or `* ` bullets, blank lines as block
 * separators, and inline `**bold**` / `*italic*`. Every other line becomes a
 * plain paragraph, so unsupported Markdown degrades to visible text instead of
 * being dropped.
 */
function parseContentBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = []

  // Stripped once here rather than per run: the `docx` package writes run text
  // into the XML verbatim, so a stray control character from an upstream block
  // would produce a package Word refuses to open. Tab, newline, and carriage
  // return are legal XML and are outside the class, so the split below is
  // unaffected.
  for (const rawLine of stripInvalidXmlChars(content).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim().length === 0) continue

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const kind = (['heading1', 'heading2', 'heading3'] as const)[heading[1].length - 1]
      blocks.push({ kind, runs: parseInlineRuns(heading[2]) })
      continue
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      blocks.push({ kind: 'bullet', runs: parseInlineRuns(bullet[1]) })
      continue
    }

    blocks.push({ kind: 'paragraph', runs: parseInlineRuns(line) })
  }

  return blocks
}

/**
 * Builds a complete `.docx` package from text content, applying the Markdown
 * subset documented on {@link parseContentBlocks}. Empty content still produces
 * a one-paragraph document so callers always get a file Word can open.
 */
export async function buildDocxFromContent(content: string, title?: string): Promise<Buffer> {
  const blocks = parseContentBlocks(content ?? '')

  const paragraphs = blocks.map((block) => {
    const children = block.runs.map(
      (run) => new TextRun({ text: run.text, bold: run.bold, italics: run.italic })
    )

    if (block.kind === 'bullet') {
      return new Paragraph({ children, bullet: { level: 0 } })
    }
    if (block.kind === 'paragraph') {
      return new Paragraph({ children })
    }
    return new Paragraph({ children, heading: HEADING_LEVEL_BY_KIND[block.kind] })
  })

  const document = new Document({
    ...(title ? { title } : {}),
    sections: [{ children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })] }],
  })

  return Packer.toBuffer(document)
}

/** Escapes text for an XML text node and drops characters XML 1.0 forbids. */
function escapeXmlText(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Renders lines as WordprocessingML paragraphs. Append deliberately emits plain
 * paragraphs with no style or numbering references: the target document is
 * user-owned and may not define `Heading1` or a numbering definition, and a
 * dangling reference renders unpredictably in Word.
 */
function buildAppendedParagraphsXml(content: string): { xml: string; paragraphs: number } {
  const lines = (content ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  return {
    xml: lines
      .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r></w:p>`)
      .join(''),
    paragraphs: lines.length,
  }
}

/**
 * Finds the offset in `word/document.xml` where new body-level paragraphs belong.
 *
 * WordprocessingML puts the body-level `<w:sectPr>` last inside `<w:body>`, and
 * content must be inserted before it. A `<w:sectPr>` can also appear inside a
 * paragraph's `<w:pPr>` for a section break, so the candidate counts as
 * body-level only when no paragraph closes between it and `</w:body>`.
 */
function findBodyInsertionIndex(xml: string): number {
  const bodyEnd = xml.lastIndexOf('</w:body>')
  if (bodyEnd === -1) {
    throw new Error('Document is not a valid Word file: no document body found')
  }

  const sectPrStart = xml.lastIndexOf('<w:sectPr', bodyEnd)
  if (sectPrStart === -1) return bodyEnd

  return xml.slice(sectPrStart, bodyEnd).includes('</w:p>') ? bodyEnd : sectPrStart
}

/**
 * Appends paragraphs to the end of an existing `.docx` package, rewriting only
 * the body of `word/document.xml`. Every other part — styles, numbering, images,
 * headers — is repacked untouched, so existing content and formatting survive.
 */
export async function appendParagraphsToDocx(
  existing: Buffer,
  content: string
): Promise<{ buffer: Buffer; paragraphsAppended: number }> {
  assertOoxmlArchiveWithinLimits(existing)

  const zip = await JSZip.loadAsync(existing)
  const documentPart = zip.file(DOCUMENT_PART_PATH)
  if (!documentPart) {
    throw new Error(`Document is not a valid Word file: missing ${DOCUMENT_PART_PATH}`)
  }

  const appended = buildAppendedParagraphsXml(content)
  if (appended.paragraphs === 0) {
    // Whitespace-only input contributes no paragraph. Returning the original
    // package unchanged lets the caller skip the upload rather than rewrite the
    // document with identical content and bump its modified time.
    return { buffer: existing, paragraphsAppended: 0 }
  }

  const xml = await documentPart.async('string')
  const insertionIndex = findBodyInsertionIndex(xml)

  zip.file(
    DOCUMENT_PART_PATH,
    xml.slice(0, insertionIndex) + appended.xml + xml.slice(insertionIndex)
  )

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    paragraphsAppended: appended.paragraphs,
  }
}

/**
 * Extracts the plain text of a `.docx` package through the shared file parser so
 * Word documents read the same way here as everywhere else in Sim.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await new DocxParser().parseBuffer(buffer)
    return result.content
  } catch (error) {
    // The shared parser treats "extracted nothing" as a failure, which is right
    // for a corrupt upload but wrong for a document a user simply has not typed
    // in yet. Only a structurally valid, genuinely empty package is rescued.
    if (await isEmptyWordPackage(buffer)) {
      return ''
    }
    throw error
  }
}

/** Whether the buffer is a valid Word package whose body holds no text. */
async function isEmptyWordPackage(buffer: Buffer): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const part = zip.file(DOCUMENT_PART_PATH)
    if (!part) return false

    const xml = await part.async('string')
    return collectTextNodes(xml).every((node) => node.text.trim().length === 0)
  } catch {
    return false
  }
}

/** Decodes the XML entities WordprocessingML uses inside a `<w:t>` text node. */
function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Escapes a literal for embedding in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface TextNode {
  /** Offset of the whole `<w:t …>…</w:t>` element within its paragraph. */
  start: number
  end: number
  text: string
}

const TEXT_NODE_PATTERN = /<w:t(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/w:t>)/g
const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*?)?>[\s\S]*?<\/w:p>/g

/** Renders a `<w:t>` element that preserves surrounding whitespace. */
function renderTextNode(text: string): string {
  return `<w:t xml:space="preserve">${escapeXmlText(text)}</w:t>`
}

/** Collects the `<w:t>` elements inside one paragraph, in document order. */
function collectTextNodes(paragraph: string): TextNode[] {
  const nodes: TextNode[] = []
  TEXT_NODE_PATTERN.lastIndex = 0

  for (
    let match = TEXT_NODE_PATTERN.exec(paragraph);
    match !== null;
    match = TEXT_NODE_PATTERN.exec(paragraph)
  ) {
    nodes.push({
      start: match.index,
      end: match.index + match[0].length,
      text: decodeXmlText(match[1] ?? ''),
    })
  }

  return nodes
}

function countOccurrences(haystack: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  return haystack.match(pattern)?.length ?? 0
}

/**
 * Replaces every occurrence of the pattern inside one paragraph.
 *
 * Word splits a single visible sentence across several runs whenever formatting,
 * spell-check state, or revision marks change, so a placeholder frequently spans
 * run boundaries. When every occurrence happens to sit inside one run the
 * replacement is done in place and all per-run formatting survives. When an
 * occurrence straddles runs the paragraph's text is rebuilt into its first run
 * and the remaining runs are emptied — the only way to complete the replacement
 * without inventing formatting, at the cost of collapsing that paragraph onto
 * its first run's style.
 */
function replaceInParagraph(
  paragraph: string,
  pattern: RegExp,
  replacement: string
): { paragraph: string; occurrences: number } {
  const nodes = collectTextNodes(paragraph)
  if (nodes.length === 0) return { paragraph, occurrences: 0 }

  const combined = nodes.map((node) => node.text).join('')
  const total = countOccurrences(combined, pattern)
  if (total === 0) return { paragraph, occurrences: 0 }

  const perNode = nodes.reduce((sum, node) => sum + countOccurrences(node.text, pattern), 0)

  if (perNode === total) {
    let rebuilt = ''
    let cursor = 0
    for (const node of nodes) {
      pattern.lastIndex = 0
      rebuilt += paragraph.slice(cursor, node.start)
      rebuilt += renderTextNode(node.text.replace(pattern, replacement))
      cursor = node.end
    }
    return { paragraph: rebuilt + paragraph.slice(cursor), occurrences: total }
  }

  pattern.lastIndex = 0
  const replaced = combined.replace(pattern, replacement)

  let rebuilt = paragraph.slice(0, nodes[0].start) + renderTextNode(replaced)
  let cursor = nodes[0].end
  for (const node of nodes.slice(1)) {
    rebuilt += paragraph.slice(cursor, node.start) + renderTextNode('')
    cursor = node.end
  }

  return { paragraph: rebuilt + paragraph.slice(cursor), occurrences: total }
}

/** Applies the replacement to every paragraph of one XML part. */
function replaceInPart(
  xml: string,
  pattern: RegExp,
  replacement: string
): { xml: string; occurrences: number } {
  let occurrences = 0
  PARAGRAPH_PATTERN.lastIndex = 0

  const next = xml.replace(PARAGRAPH_PATTERN, (paragraph) => {
    const result = replaceInParagraph(paragraph, pattern, replacement)
    occurrences += result.occurrences
    return result.paragraph
  })

  return { xml: next, occurrences }
}

/**
 * Parts a find-and-replace touches. Word's own Replace All covers the body plus
 * every header and footer, and template placeholders regularly live in a header,
 * so limiting this to `word/document.xml` would silently miss them.
 */
const REPLACEABLE_PART_PATTERN = /^word\/(document|header\d*|footer\d*)\.xml$/

/** One literal find-and-replace pair. */
export interface DocxReplacement {
  find: string
  replace: string
}

/**
 * Replaces literal text throughout a `.docx` package and reports how many
 * occurrences changed.
 *
 * Matching never spans a paragraph boundary, mirroring Word's own Replace All.
 * Multiple replacements are applied in order over the whole document, so a later
 * pair can match text an earlier one produced — the same as running Replace All
 * repeatedly by hand.
 */
export async function replaceTextInDocx(
  existing: Buffer,
  replacements: readonly DocxReplacement[],
  matchCase: boolean
): Promise<{ buffer: Buffer; occurrencesChanged: number }> {
  if (replacements.length === 0) {
    throw new Error('At least one replacement is required')
  }
  if (replacements.some((replacement) => !replacement.find)) {
    throw new Error('Search text is required for every replacement')
  }

  assertOoxmlArchiveWithinLimits(existing)

  const zip = await JSZip.loadAsync(existing)
  if (!zip.file(DOCUMENT_PART_PATH)) {
    throw new Error(`Document is not a valid Word file: missing ${DOCUMENT_PART_PATH}`)
  }

  const compiled = replacements.map(({ find, replace }) => ({
    pattern: new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi'),
    // `$` is a substitution directive to String.replace; the caller means it literally.
    replacement: replace.replace(/\$/g, '$$$$'),
  }))

  let occurrencesChanged = 0

  for (const path of Object.keys(zip.files)) {
    if (!REPLACEABLE_PART_PATTERN.test(path)) continue

    const part = zip.file(path)
    if (!part) continue

    let xml = await part.async('string')
    let partOccurrences = 0

    for (const { pattern, replacement } of compiled) {
      const result = replaceInPart(xml, pattern, replacement)
      xml = result.xml
      partOccurrences += result.occurrences
    }

    if (partOccurrences > 0) {
      occurrencesChanged += partOccurrences
      zip.file(path, xml)
    }
  }

  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    occurrencesChanged,
  }
}

/**
 * Normalizes the `replacements` tool param, which arrives either as an object
 * from the editor or as a JSON string once it has passed through a variable
 * reference. Values are coerced to strings so a number or boolean from an
 * upstream block still substitutes cleanly.
 */
export function parseReplacements(value: unknown): DocxReplacement[] {
  if (value === null || value === undefined) return []

  let raw = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      raw = JSON.parse(trimmed)
    } catch {
      throw new Error('Replacements must be a JSON object mapping each placeholder to its value')
    }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Replacements must be a JSON object mapping each placeholder to its value')
  }

  return Object.entries(raw as Record<string, unknown>).map(([find, replace]) => ({
    find,
    replace: replace === null || replace === undefined ? '' : String(replace),
  }))
}
