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

/**
 * Strips HTML tags from content and decodes common HTML entities.
 */
export function htmlToPlainText(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return text.replace(/\s+/g, ' ').trim()
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
