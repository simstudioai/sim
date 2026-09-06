import { isPlainRecord } from '@sim/utils/object'
import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import {
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
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

/** Maximum number of Microsoft Graph folders retained between connector pages. */
export const MICROSOFT_GRAPH_MAX_PENDING_FOLDERS = 10_000

/**
 * Graph IDs are opaque strings with no documented maximum. This ceiling is far
 * above ordinary identifiers while making the traversal's string working set
 * provably bounded even if a provider response or stored cursor is malformed.
 */
export const MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES = 512

/** Maximum server-issued continuation URL accepted into a traversal cursor. */
export const MICROSOFT_GRAPH_MAX_NEXT_LINK_BYTES = 16 * 1024

/** Maximum serialized traversal state, before and after base64 encoding. */
export const MICROSOFT_GRAPH_MAX_CURSOR_JSON_BYTES = 8 * 1024 * 1024
export const MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES = 12 * 1024 * 1024

/** Parses an optional connector limit where zero or omission means unlimited. */
export function parseOptionalUnlimitedSafeInteger(value: unknown, errorMessage: string): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(errorMessage)
  }

  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return 0
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new Error(errorMessage)
  }

  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(errorMessage)
  }
  return parsed
}

/**
 * Parses a connector cap that keeps `defaultValue` when the field is blank —
 * absent, null, or a string of nothing but whitespace — and otherwise reads
 * like {@link parseOptionalUnlimitedSafeInteger}, where 0 lifts the cap. A
 * per-member sync writes that explicit 0; a form left empty must not.
 */
export function parseDefaultedUnlimitedSafeInteger(
  value: unknown,
  defaultValue: number,
  errorMessage: string
): number {
  if (value === undefined || value === null) return defaultValue
  if (typeof value === 'string' && value.trim() === '') return defaultValue
  return parseOptionalUnlimitedSafeInteger(value, errorMessage)
}

const MICROSOFT_GRAPH_ORIGIN = 'https://graph.microsoft.com'

export interface MicrosoftGraphTraversalState {
  nextLink?: string
  currentFolder?: string
  folderStack: string[]
}

export interface MicrosoftGraphDriveItemShape {
  id: string
  name: string
  file?: Record<string, unknown>
  folder?: Record<string, unknown>
  package?: Record<string, unknown>
  remoteItem?: Record<string, unknown>
}

export function isMicrosoftGraphDriveItem(value: unknown): value is MicrosoftGraphDriveItemShape {
  return (
    isPlainRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (isPlainRecord(value.file) ||
      isPlainRecord(value.folder) ||
      isPlainRecord(value.package) ||
      isPlainRecord(value.remoteItem))
  )
}

export function parseMicrosoftGraphDriveItemList(
  value: unknown,
  label: string
): { value: MicrosoftGraphDriveItemShape[]; nextLink?: string } {
  if (!isPlainRecord(value) || !Array.isArray(value.value)) {
    throw new Error(`Microsoft Graph returned malformed ${label} list metadata`)
  }
  if (!value.value.every(isMicrosoftGraphDriveItem)) {
    throw new Error(`Microsoft Graph returned malformed ${label} item metadata`)
  }
  const nextLink =
    value['@odata.nextLink'] === undefined
      ? undefined
      : assertMicrosoftGraphNextLink(value['@odata.nextLink'])
  return { value: value.value, nextLink }
}

function assertBoundedGraphString(
  value: unknown,
  maxBytes: number,
  field: string,
  allowEmpty = false
): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`Invalid Microsoft Graph traversal cursor: ${field} must be a string`)
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`Invalid Microsoft Graph traversal cursor: ${field} exceeds its size limit`)
  }
}

/** Validates a Graph continuation URL before a bearer token can be sent to it. */
export function assertMicrosoftGraphNextLink(value: unknown): string {
  assertBoundedGraphString(value, MICROSOFT_GRAPH_MAX_NEXT_LINK_BYTES, 'nextLink')
  const url = new URL(value.trim())
  if (url.origin !== MICROSOFT_GRAPH_ORIGIN) {
    throw new Error('Refusing to follow a non-Microsoft Graph @odata.nextLink')
  }
  return url.toString()
}

function validateMicrosoftGraphTraversalState(
  value: unknown,
  label: string
): MicrosoftGraphTraversalState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label} pagination cursor`)
  }

  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.folderStack)) {
    throw new Error(`Invalid ${label} pagination cursor: folderStack must be an array`)
  }
  if (candidate.folderStack.length > MICROSOFT_GRAPH_MAX_PENDING_FOLDERS) {
    throw new Error(
      `${label} folder traversal exceeds the safe limit of ${MICROSOFT_GRAPH_MAX_PENDING_FOLDERS.toLocaleString()} pending folders. Narrow the connector to a document library or subfolder and retry.`
    )
  }

  const folderStack = candidate.folderStack.map((folderId, index) => {
    assertBoundedGraphString(folderId, MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES, `folderStack[${index}]`)
    return folderId
  })

  let currentFolder: string | undefined
  if (candidate.currentFolder !== undefined) {
    assertBoundedGraphString(
      candidate.currentFolder,
      MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES,
      'currentFolder'
    )
    currentFolder = candidate.currentFolder
  }

  const nextLink =
    candidate.nextLink === undefined ? undefined : assertMicrosoftGraphNextLink(candidate.nextLink)

  return { folderStack, currentFolder, nextLink }
}

/**
 * Encodes bounded Graph traversal state. Base64 is canonical; decoding also
 * accepts the former OneDrive raw-JSON cursor so in-flight syncs survive rollout.
 */
export function encodeMicrosoftGraphTraversalCursor(
  state: MicrosoftGraphTraversalState,
  label: string
): string {
  const validated = validateMicrosoftGraphTraversalState(state, label)
  const json = JSON.stringify(validated)
  if (Buffer.byteLength(json, 'utf8') > MICROSOFT_GRAPH_MAX_CURSOR_JSON_BYTES) {
    throw new Error(`Invalid ${label} pagination cursor: serialized state exceeds its size limit`)
  }
  const encoded = Buffer.from(json).toString('base64')
  if (Buffer.byteLength(encoded, 'utf8') > MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES) {
    throw new Error(`Invalid ${label} pagination cursor: encoded state exceeds its size limit`)
  }
  return encoded
}

export function decodeMicrosoftGraphTraversalCursor(
  cursor: string,
  label: string
): MicrosoftGraphTraversalState {
  if (Buffer.byteLength(cursor, 'utf8') > MICROSOFT_GRAPH_MAX_CURSOR_ENCODED_BYTES) {
    throw new Error(`Invalid ${label} pagination cursor: encoded state exceeds its size limit`)
  }

  let json: string
  try {
    json = cursor.trimStart().startsWith('{')
      ? cursor
      : Buffer.from(cursor, 'base64').toString('utf8')
  } catch {
    throw new Error(`Invalid ${label} pagination cursor`)
  }
  if (Buffer.byteLength(json, 'utf8') > MICROSOFT_GRAPH_MAX_CURSOR_JSON_BYTES) {
    throw new Error(`Invalid ${label} pagination cursor: serialized state exceeds its size limit`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error(`Invalid ${label} pagination cursor`)
  }
  return validateMicrosoftGraphTraversalState(parsed, label)
}

export function appendPendingMicrosoftGraphFolders(
  pendingFolders: string[],
  discoveredFolders: string[],
  label: string
): void {
  if (pendingFolders.length + discoveredFolders.length > MICROSOFT_GRAPH_MAX_PENDING_FOLDERS) {
    throw new Error(
      `${label} folder traversal exceeds the safe limit of ${MICROSOFT_GRAPH_MAX_PENDING_FOLDERS.toLocaleString()} pending folders. Narrow the connector to a document library or subfolder and retry.`
    )
  }
  for (let index = 0; index < discoveredFolders.length; index++) {
    assertBoundedGraphString(
      discoveredFolders[index],
      MICROSOFT_GRAPH_MAX_ITEM_ID_BYTES,
      `discoveredFolders[${index}]`
    )
  }
  pendingFolders.push(...discoveredFolders)
}

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
export const PIPELINE_PARSED_MIME_TYPES: ReadonlyMap<string, string> = new Map([
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
  try {
    return await readResponseToBufferWithLimit(response, {
      maxBytes,
      label: 'Connector file download',
    })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) return null
    throw error
  }
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

/**
 * A listing failed because the caller cannot reach the configured scope — the
 * folder, space, board, or calendar is not shared with them. A members-mode
 * crawl treats that as a complete listing of nothing for that member, so
 * their access is withdrawn rather than retried forever.
 */
export class ConnectorListingScopeUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ConnectorListingScopeUnavailableError'
  }
}

/**
 * The error a listing request throws for a failed response: scope-unavailable
 * when the source says the scope does not exist for this caller (404, or
 * whatever `scopeUnavailable` recognises in the source's own error body), a
 * plain error for anything else, which the sync engines retry with backoff.
 */
export function listingRequestError(
  message: string,
  status: number,
  scopeUnavailable: boolean = status === 404
): Error {
  const described = `${message}: ${status}`
  return scopeUnavailable
    ? new ConnectorListingScopeUnavailableError(described, status)
    : new Error(described)
}

export function isListingScopeUnavailableError(error: unknown): boolean {
  return error instanceof ConnectorListingScopeUnavailableError
}

/**
 * The error a failed Microsoft Graph listing request throws. Graph reports a
 * drive, site, or folder the caller cannot reach as 404 (`itemNotFound`) or
 * 403 (`accessDenied`); either is a complete listing of nothing for that
 * caller, while anything else is a fault the sync engines retry.
 */
export function microsoftGraphListingError(
  message: string,
  status: number,
  detail?: string
): Error {
  const described = detail ? `${message}: ${status} – ${detail}` : `${message}: ${status}`
  return status === 403 || status === 404
    ? new ConnectorListingScopeUnavailableError(described, status)
    : new Error(described)
}

/**
 * `syncContext` entry the members-mode crawl sets on every listing it runs
 * under one member's own token. A connector that walks several scopes reads
 * it to tell that a scope the caller cannot reach is simply absent from that
 * member's complete listing, where the same failure under a shared credential
 * is a cap or an error.
 */
export const PER_MEMBER_LISTING_CONTEXT = { perMemberListing: true } as const

export function isPerMemberListing(syncContext: Record<string, unknown> | undefined): boolean {
  return syncContext?.perMemberListing === true
}

function memberDocumentPrefix(syncContext: Record<string, unknown> | undefined): string {
  const memberId = syncContext?.memberId
  if (typeof memberId !== 'string' || !memberId.trim()) {
    throw new Error('Per-member document identity requires a connector member ID')
  }
  return `member:${encodeURIComponent(memberId)}:`
}

/** Keeps credential-specific representations separate in the connector's shared document corpus. */
export function memberDocumentId(
  externalId: string,
  syncContext: Record<string, unknown> | undefined
): string {
  return isPerMemberListing(syncContext)
    ? `${memberDocumentPrefix(syncContext)}${externalId}`
    : externalId
}

/** Refuses to hydrate another member's representation using the current member's credential. */
export function sourceDocumentId(
  externalId: string,
  syncContext: Record<string, unknown> | undefined
): string | null {
  if (!isPerMemberListing(syncContext)) return externalId
  const prefix = memberDocumentPrefix(syncContext)
  return externalId.startsWith(prefix) && externalId.length > prefix.length
    ? externalId.slice(prefix.length)
    : null
}

/**
 * Whether a folder request that failed while walking a Microsoft Graph drive
 * can be left out of the listing: under a member's own token a descendant
 * folder Graph reports as unreachable (403, 404) is simply not shared with
 * them, so their listing stays complete without it and their access to its
 * files is withdrawn. The configured root is the whole scope, which the
 * members-mode crawl reads as a complete listing of nothing, and a shared
 * credential never skips: dropping the folder's files would read as deletions.
 */
export function isSkippableMicrosoftGraphFolderError(
  error: unknown,
  syncContext: Record<string, unknown> | undefined,
  isRootFolder: boolean
): boolean {
  return !isRootFolder && isListingScopeUnavailableError(error) && isPerMemberListing(syncContext)
}

/**
 * Ceiling for a document a connector assembles from many source records (a
 * mail thread, a chat transcript) rather than downloads as one file. Formatters
 * enforce it through `BoundedLines`, and listings advertise it through
 * `ExternalDocument.estimatedBytes`, so the sync engine plans hydration around
 * a bound it can rely on: five such documents fit its 64 MiB in-flight budget
 * and hydrate together instead of one at a time.
 */
export const CONNECTOR_TEXT_DOCUMENT_MAX_BYTES = 12 * 1024 * 1024

const TRAILING_TRUNCATION_NOTICE = '[Truncated: the indexed text reached the size limit]'
const LEADING_TRUNCATION_NOTICE = '[Truncated: earlier text was left out to fit the size limit]'

/**
 * Which end of the stream survives when it does not fit: `first` keeps what
 * was pushed first and refuses the rest (a mail thread, whose root message is
 * the context), `last` keeps what was pushed last and lets older records go
 * (a chat transcript, whose newest messages are the ones people search for).
 */
export type BoundedLinesKeep = 'first' | 'last'

interface BoundedRecord {
  lines: string[]
  bytes: number
}

function byteSize(lines: readonly string[]): number {
  let size = 0
  for (const line of lines) size += Buffer.byteLength(line, 'utf8') + 1
  return size
}

/**
 * Accumulates newline-joined text under a byte ceiling. A record is kept
 * whole or not at all, so a truncated document never ends mid-message, and
 * the output carries a notice where something was left out.
 */
export class BoundedLines {
  private readonly pinned: string[] = []
  private readonly records: BoundedRecord[] = []
  private pinnedBytes = 0
  private recordBytes = 0
  private truncated = false

  constructor(
    private readonly maxBytes = CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    private readonly keep: BoundedLinesKeep = 'first'
  ) {}

  /** Lines that open the document and are never let go, such as its header; counted against the ceiling. */
  pin(...lines: string[]): void {
    this.pinned.push(...lines)
    this.pinnedBytes += byteSize(lines)
  }

  /** Records currently kept. */
  get count(): number {
    return this.records.length
  }

  /**
   * Appends the lines as one record and returns whether it was kept. Keeping
   * the first, a record that does not fit is refused, and so is every later
   * one, so a caller can stop. Keeping the last, a record is refused only when
   * it cannot fit on its own, and appending it lets the oldest records go
   * until the rest fits, so a caller carries on.
   */
  push(...lines: string[]): boolean {
    const bytes = byteSize(lines)
    if (this.keep === 'first') {
      if (this.truncated) return false
      if (this.pinnedBytes + this.recordBytes + bytes > this.maxBytes) {
        this.truncated = true
        return false
      }
      this.records.push({ lines, bytes })
      this.recordBytes += bytes
      return true
    }
    if (this.pinnedBytes + bytes > this.maxBytes) {
      this.truncated = true
      return false
    }
    this.records.push({ lines, bytes })
    this.recordBytes += bytes
    while (this.pinnedBytes + this.recordBytes > this.maxBytes) {
      const oldest = this.records.shift()
      if (!oldest) break
      this.recordBytes -= oldest.bytes
      this.truncated = true
    }
    return true
  }

  /** Joins the kept lines, with the truncation notice where records were left out. */
  join(): string {
    const body = this.records.flatMap((record) => record.lines)
    if (!this.truncated) return [...this.pinned, ...body].join('\n')
    return this.keep === 'first'
      ? [...this.pinned, ...body, TRAILING_TRUNCATION_NOTICE].join('\n')
      : [...this.pinned, LEADING_TRUNCATION_NOTICE, ...body].join('\n')
  }
}
