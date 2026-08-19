import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import { MAX_FILE_SIZE as KB_DOCUMENT_MAX_BYTES } from '@/lib/uploads/utils/validation'
import type { ExternalDocument } from '@/connectors/types'

/**
 * Per-file size cap for knowledge base connector syncs. Aligned with the limit for
 * manually uploaded KB documents (`MAX_FILE_SIZE` in `uploads/validation`) so a
 * connector indexes the same files a user could add by hand — rather than the much
 * lower proxy-derived 10 MB number that previously (and arbitrarily) applied here.
 *
 * Connector downloads are streamed against this cap via `readBodyWithLimit`, and
 * files above it are surfaced as skipped (failed) documents instead of being dropped
 * silently, so raising the limit stays memory-safe and visible.
 */
export const CONNECTOR_MAX_FILE_BYTES = KB_DOCUMENT_MAX_BYTES

/** The named entities connector markup actually carries, decoded to their character. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
}

/**
 * The C1 range (0x80–0x9F) remapped to the windows-1252 characters browsers
 * render, per the HTML standard's numeric character reference table.
 *
 * Legacy CMS exports — WordPress and Zendesk especially — emit typographic
 * punctuation as `&#146;`/`&#147;`/`&#151;`. Those code points are unassigned
 * controls in Unicode, so decoding them literally would put invisible garbage
 * into the index where the source plainly meant `’`, `“`, `—`.
 */
const WINDOWS_1252_C1 = new Map<number, string>([
  [0x80, '€'],
  [0x82, '‚'],
  [0x83, 'ƒ'],
  [0x84, '„'],
  [0x85, '…'],
  [0x86, '†'],
  [0x87, '‡'],
  [0x88, 'ˆ'],
  [0x89, '‰'],
  [0x8a, 'Š'],
  [0x8b, '‹'],
  [0x8c, 'Œ'],
  [0x8e, 'Ž'],
  [0x91, '‘'],
  [0x92, '’'],
  [0x93, '“'],
  [0x94, '”'],
  [0x95, '•'],
  [0x96, '–'],
  [0x97, '—'],
  [0x98, '˜'],
  [0x99, '™'],
  [0x9a, 'š'],
  [0x9b, '›'],
  [0x9c, 'œ'],
  [0x9e, 'ž'],
  [0x9f, 'Ÿ'],
])

/** Controls worth decoding — every other control code point stays literal. */
const DECODABLE_CONTROLS = new Set([0x09, 0x0a, 0x0d])

/**
 * One alternation covering every reference form, so the whole string is decoded
 * in a single left-to-right pass. That ordering is what makes an escaped entity
 * safe: `&amp;#8217;` consumes `&amp;` and resumes *after* it, leaving the
 * literal text `&#8217;` rather than decoding it a second time.
 */
const HTML_ENTITY_PATTERN = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|nbsp));/g

/**
 * Resolves a numeric character reference to its character, or returns the
 * reference as written when the code point would not survive indexing.
 *
 * Out-of-range values, lone surrogates, and control characters — notably `&#0;`,
 * which Postgres rejects outright in a text column — degrade to literal text so
 * malformed source markup never aborts a sync.
 */
function decodeCharacterReference(raw: string, code: number): string {
  if (code > 0x10ffff) return raw
  if (code >= 0xd800 && code <= 0xdfff) return raw

  const remapped = WINDOWS_1252_C1.get(code)
  if (remapped !== undefined) return remapped

  const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f)
  if (isControl && !DECODABLE_CONTROLS.has(code)) return raw

  return String.fromCodePoint(code)
}

/**
 * Anchored to a tag-name allowlist rather than the looser `<[a-z!/]` shape,
 * because {@link htmlToPlainText} both strips tags and collapses all whitespace.
 * A false positive therefore does not merely pass text through untouched — it
 * deletes the bracketed span and flattens the document's line structure. Plain
 * text routinely contains angle brackets that are not markup: an email address
 * (`Reply from John <john@acme.com>`), a markdown autolink
 * (`<https://acme.com>`), or a placeholder (`<redacted>`).
 */
const HTML_TAG_PATTERN =
  /<\/?(?:p|div|br|hr|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|span|strong|em|b|i|u|a|code|pre|blockquote|img|figure)\b[^>]*>/i

/**
 * Reports whether a value carries real HTML markup and is therefore worth routing
 * through {@link htmlToPlainText}. Use this instead of a hand-rolled tag test so
 * connectors cannot drift apart on what counts as markup.
 */
export function looksLikeHtml(value: string): boolean {
  return HTML_TAG_PATTERN.test(value)
}

/**
 * Strips HTML tags from content and decodes HTML entities, including numeric
 * character references in decimal (`&#8217;`) and hex (`&#x2019;`) form.
 *
 * Rendered CMS content — WordPress, Zendesk, Confluence — emits typographic
 * punctuation as numeric references, which previously reached the index verbatim.
 */
export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(HTML_ENTITY_PATTERN, (raw: string, hex?: string, decimal?: string, named?: string) => {
      if (named !== undefined) return NAMED_ENTITIES[named] ?? raw
      if (hex !== undefined) return decodeCharacterReference(raw, Number.parseInt(hex, 16))
      if (decimal !== undefined) return decodeCharacterReference(raw, Number.parseInt(decimal, 10))
      return raw
    })
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Extensions a file-based connector reads straight off the wire as UTF-8. These are
 * the formats connectors have always accepted, and they deliberately keep bypassing
 * the knowledge-base parsers: routing `.csv` through `CsvParser` or `.json` through
 * the JSON parser would reformat content that is already indexed, changing what is
 * embedded for every existing connector document on its next re-index.
 */
const CONNECTOR_TEXT_EXTENSIONS = [
  'txt',
  'md',
  'html',
  'htm',
  'csv',
  'json',
  'jsonl',
  'xml',
  'yaml',
  'yml',
  'log',
  'rst',
  'tsv',
] as const

/**
 * Binary document formats extracted through the shared knowledge-base file parsers.
 * Listing them separately from {@link CONNECTOR_TEXT_EXTENSIONS} is what keeps this
 * additive: a format that synced yesterday takes exactly the path it took yesterday.
 *
 * The set covers the variants a real document library actually holds, not just the
 * headline extension of each family — macro-enabled (`docm`, `xlsm`, `pptm`) and
 * template (`dotx`, `xltx`, `potx`) files are the same OOXML packages, the binary
 * workbook (`xlsb`) and legacy BIFF workbook (`xls`) are read by SheetJS, and the
 * OpenDocument trio covers LibreOffice and Google Docs exports.
 *
 * `rtf` is deliberately absent: no bundled library extracts it, and `DocParser`
 * would pass its control words through as if they were prose. See
 * {@link CONNECTOR_INDEXABLE_EXTENSIONS} for how an unsupported format surfaces.
 *
 * Mapping each to its MIME type rather than listing extensions alone lets the
 * stored object declare what it is, which is what the pipeline's OCR routing
 * reads. Derived from the extension rather than trusting the source's own
 * declaration, so a provider that omits or mislabels it cannot strand a PDF on
 * the non-OCR path.
 */
const PIPELINE_PARSED_MIME_TYPES = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['docm', 'application/vnd.ms-word.document.macroEnabled.12'],
  ['dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
  ['xlsb', 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'],
  ['xltx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.template'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
  ['potx', 'application/vnd.openxmlformats-officedocument.presentationml.template'],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['odp', 'application/vnd.oasis.opendocument.presentation'],
])

/**
 * Every extension a file-based connector will download and index.
 *
 * Previously each connector carried its own text-only whitelist, so an Office
 * document in a synced folder was dropped during listing — no document, no failed
 * row, no log line. A library of `.docx` SOPs therefore synced as "success, 0
 * documents", which is indistinguishable from a wrong folder path.
 */
export const CONNECTOR_INDEXABLE_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ...CONNECTOR_TEXT_EXTENSIONS,
  ...PIPELINE_PARSED_MIME_TYPES.keys(),
])

/** Extracts a lowercased, dotless extension from a file name. */
export function connectorFileExtension(fileName: string): string | undefined {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === fileName.length - 1) return undefined
  return fileName.slice(dotIndex + 1).toLowerCase()
}

/**
 * Reports whether a connector should download and index a file, based on its name.
 */
export function isIndexableConnectorFile(fileName: string): boolean {
  const extension = connectorFileExtension(fileName)
  return extension !== undefined && CONNECTOR_INDEXABLE_EXTENSIONS.has(extension)
}

/**
 * Whether a document carries anything worth indexing.
 *
 * A source file has to have bytes. A zero-byte file is not payload: it produces an
 * empty stored object, and for a PDF that reaches OCR as an empty request and comes
 * back as an opaque `400 Bad Request` — billing an external call to learn the file
 * was empty, and reporting it as an API fault rather than as what it is.
 */
export function hasIndexablePayload(
  doc: Pick<ExternalDocument, 'content' | 'sourceFile'>
): boolean {
  if (doc.sourceFile) return doc.sourceFile.bytes.length > 0
  return doc.content.trim().length > 0
}

/**
 * MIME type to store a file under when the shared pipeline should parse it, or
 * `undefined` when the connector should decode it as text itself.
 *
 * A format the knowledge base can parse is handed over untouched: the pipeline
 * routes PDFs to OCR and owns every other parser, so extracting here would strand
 * the document on a weaker one and discard the original.
 */
export function pipelineParsedMimeType(fileName: string): string | undefined {
  const extension = connectorFileExtension(fileName)
  return extension ? PIPELINE_PARSED_MIME_TYPES.get(extension) : undefined
}

/**
 * Converts a downloaded file body to indexable text.
 *
 * Only for formats that are already text — anything the shared parsers handle is
 * delivered to them verbatim instead, via {@link pipelineParsedMimeType}. HTML is
 * additionally reduced to plain text; everything else is a UTF-8 decode.
 */
export function extractConnectorText(buffer: Buffer, fileName: string): string {
  const extension = connectorFileExtension(fileName)

  if (extension === 'html' || extension === 'htm') {
    return htmlToPlainText(buffer.toString('utf8'))
  }

  return buffer.toString('utf8')
}

/**
 * Computes a SHA-256 hash of the given content string.
 * Used by connectors for change detection during sync.
 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Parses a string metadata value as a Date for tag mapping.
 * Returns the Date if valid, undefined otherwise.
 */
export function parseTagDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Joins an array metadata value into a comma-separated string for tag mapping.
 * Returns the joined string if non-empty, undefined otherwise.
 */
export function joinTagArray(value: unknown): string | undefined {
  const arr = Array.isArray(value) ? (value as string[]) : []
  return arr.length > 0 ? arr.join(', ') : undefined
}

/**
 * Normalizes a multi-value sourceConfig field into a trimmed, deduplicated string array.
 *
 * Accepts a string (CSV from advanced manual input or legacy single-value), an array
 * of strings (from multi-select UI or new array storage), or undefined/null. Always
 * returns a string[] — connectors call this once at the top of listDocuments to
 * branch on `values.length` for single vs multi behavior.
 */
export function parseMultiValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') continue
      const trimmed = item.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
    return out
  }
  if (typeof value === 'string') {
    const seen = new Set<string>()
    const out: string[] = []
    for (const part of value.split(',')) {
      const trimmed = part.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
    return out
  }
  return []
}

/**
 * Escapes a value for safe interpolation into a Google Drive `q` query string,
 * neutralizing backslashes and single quotes to prevent query injection.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Builds a Drive `q` clause matching files parented by any of the given folder
 * IDs — e.g. `('A' in parents or 'B' in parents)`. Returns null when no folder
 * IDs are supplied so callers can omit the clause entirely. A single ID is
 * emitted without wrapping parentheses to keep the query minimal.
 */
export function buildDriveParentsClause(folderIds: string[]): string | null {
  if (folderIds.length === 0) return null
  const clause = folderIds.map((id) => `'${escapeDriveQueryValue(id)}' in parents`).join(' or ')
  return folderIds.length > 1 ? `(${clause})` : clause
}

/**
 * Reads a response body into a Buffer while enforcing a hard byte cap. The
 * declared `content-length` header cannot be trusted as the sole guard —
 * chunked transfer encoding may omit it entirely — so bytes are accumulated
 * from the stream and reading aborts as soon as the cap is exceeded, ensuring
 * an oversized (or hostile) body is never fully buffered into memory.
 * Returns null when the cap is exceeded.
 */
export async function readBodyWithLimit(
  response: Response | SecureFetchResponse,
  maxBytes: number
): Promise<Buffer | null> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.byteLength > maxBytes ? null : buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * Marks a listed document stub as intentionally skipped — for example because it
 * exceeds the connector's size limit. The sync engine records these as `failed`
 * documents carrying `skippedReason`, so oversized files stay visible in the
 * knowledge base UI instead of vanishing from the index silently. Reuses the
 * connector's own stub so the externalId, contentHash, sourceUrl, and metadata
 * (including fileSize) are preserved.
 */
export function markSkipped(stub: ExternalDocument, reason: string): ExternalDocument {
  return { ...stub, content: '', contentDeferred: false, skippedReason: reason }
}

/** Human-readable size-limit skip reason, e.g. "File exceeds the 10MB size limit". */
export function sizeLimitSkipReason(maxBytes: number): string {
  return `File exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB size limit and was not indexed`
}

/**
 * Returns the listing stub as-is, or a skipped marker when its size exceeds the cap.
 * Lets each connector express the listing-time size decision once instead of
 * repeating the `size > max ? markSkipped(...) : stub` ternary (and building the stub
 * twice). A missing/zero size is treated as within the cap (oversize is then caught
 * at fetch time via `ConnectorFileTooLargeError`).
 */
export function stubOrSkipBySize(
  stub: ExternalDocument,
  size: number | undefined,
  maxBytes: number
): ExternalDocument {
  return size && size > maxBytes ? markSkipped(stub, sizeLimitSkipReason(maxBytes)) : stub
}

/** True when a stub has been flagged as skipped (e.g. oversized) via `markSkipped`. */
export function isSkippedDocument(doc: ExternalDocument): boolean {
  return doc.skippedReason !== undefined
}

/**
 * Applies a document cap (`maxFiles`/`maxObjects`/`maxRecordings`) to a page of
 * listing items so that only **indexable** items consume the cap. Skipped
 * (oversized) items still ride along and surface as failed rows, but they no longer
 * count toward the budget — otherwise a run of oversized files at the front of a
 * listing could exhaust the cap before any indexable file is listed, silently
 * shrinking real sync coverage.
 *
 * Items are walked in listing order: every item (indexable or skipped) is emitted
 * until the indexable quota is reached, then iteration stops. A cap of `0` (or less)
 * means unlimited and all items pass through.
 *
 * @param items page items in listing order
 * @param isSkipped predicate identifying non-indexable (skipped) items
 * @param max configured cap; `0` or less means no cap
 * @param alreadyIndexed indexable items already counted on previous pages
 * @returns the emitted items, the number of indexable items emitted (the only ones
 *   that count toward the cap), and whether the cap is now reached
 */
export function takeIndexableWithinCap<T>(
  items: T[],
  isSkipped: (item: T) => boolean,
  max: number,
  alreadyIndexed: number
): { documents: T[]; indexableCount: number; capReached: boolean } {
  if (max <= 0) {
    let indexableCount = 0
    for (const item of items) {
      if (!isSkipped(item)) indexableCount += 1
    }
    return { documents: items, indexableCount, capReached: false }
  }

  const remaining = max - alreadyIndexed
  const documents: T[] = []
  let indexableCount = 0
  for (const item of items) {
    if (indexableCount >= remaining) break
    documents.push(item)
    if (!isSkipped(item)) indexableCount += 1
  }
  return { documents, indexableCount, capReached: alreadyIndexed + indexableCount >= max }
}

/**
 * Raised by a connector when a file exceeds its size cap mid-download — i.e. the
 * listing did not report a size, so the limit is only discovered while streaming.
 * `getDocument` catches it and returns a `markSkipped` document so the file surfaces
 * as a failed row instead of being dropped silently.
 */
export class ConnectorFileTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`File exceeds the ${Math.round(limitBytes / (1024 * 1024))}MB size limit`)
    this.name = 'ConnectorFileTooLargeError'
  }
}
