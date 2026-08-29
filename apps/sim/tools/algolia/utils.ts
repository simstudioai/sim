import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Builds the traversal-safe path component for an Algolia `objectID`.
 *
 * `objectID` differs from every other identifier these tools interpolate: it is
 * an arbitrary caller-chosen string, and Algolia's own clients percent-encode
 * it, so a record keyed `products/123` is a legitimate value that has always
 * worked. `safeUrlPathSegment` rejects path separators outright, so applying it
 * whole would break those records.
 *
 * A separator-bearing id needs no dot-segment check of its own. Percent-encoding
 * collapses the whole value into a *single* path segment, and the WHATWG URL
 * parser does not decode `%2F`, so no interior piece is ever a path segment that
 * dot-segment removal could act on:
 *
 * ```
 * new URL('https://x/1/indexes/p/' + encodeURIComponent('catalog/../../1/keys')).pathname
 * // => '/1/indexes/p/catalog%2F..%2F..%2F1%2Fkeys'  (intact)
 * new URL('https://x/1/indexes/p/' + encodeURIComponent('catalog/.')).pathname
 * // => '/1/indexes/p/catalog%2F.'                   (intact)
 * ```
 *
 * A value containing a separator therefore cannot be the dangerous shape, which
 * is a value whose *entire* text is `.` or `..`. Encoding it verbatim is both
 * safe and byte-identical to the `encodeURIComponent(objectID.trim())` this
 * replaced, preserving internal whitespace (`catalog/ sku`) and empty components
 * (`catalog//sku`) exactly as before.
 *
 * Everything without a separator goes through the shared guard, which owns the
 * dot-segment rejection, the empty check, and the non-string input handling.
 *
 * @param value - The raw `objectID`, typically LLM-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The percent-encoded object id, safe to interpolate into a path.
 * @throws If the value is empty, is exactly `.` or `..`, or cannot be encoded.
 */
export function safeAlgoliaObjectId(value: string, paramName: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      try {
        return encodeURIComponent(trimmed)
      } catch {
        throw new Error(`${paramName} contains an unpaired UTF-16 surrogate and cannot be encoded`)
      }
    }
  }

  return safeUrlPathSegment(value, paramName)
}
