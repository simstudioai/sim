import { serializeMarkdownDocument } from './markdown-parse'
import { isRoundTripSafe } from './round-trip-safety'

/**
 * The canonical form the rich editor serializes a document to (`*`→`-` bullets, padded table cells,
 * `_em_`→`*em*`, …). A markdown file authored elsewhere (e.g. the former Monaco editor) is rarely in
 * this form, so the editor's first mount-time re-serialization would otherwise read as an unsaved edit
 * and falsely mark the file dirty. Normalizing the dirty-check baseline to this exact form on open
 * neutralizes that — verified to match the live editor's own serialization byte-for-byte.
 *
 * Round-trip-UNSAFE content (raw HTML, footnotes, >256KB) is returned untouched: those files open
 * read-only and must display their original bytes, never a lossy re-serialization.
 */
export function normalizeMarkdownContent(raw: string): string {
  if (!isRoundTripSafe(raw)) return raw
  return serializeMarkdownDocument(raw)
}
