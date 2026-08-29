import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Builds the traversal-safe path component for an Algolia `objectID`.
 *
 * `objectID` differs from every other identifier these tools interpolate: it is
 * an arbitrary caller-chosen string, and Algolia's own clients percent-encode
 * it, so a record keyed `products/123` is a legitimate value that has always
 * worked. `safeUrlPathSegment` rejects path separators outright, so applying it
 * whole would break those records — a behaviour change for valid input.
 *
 * Splitting on `/` and guarding each piece keeps the emitted text identical to
 * the previous `encodeURIComponent(objectID)` for every value that does not
 * contain a dot segment (`encodeURIComponent('a/b')` is `'a%2Fb'`, which is
 * exactly what rejoining the encoded pieces with `%2F` produces), while still
 * refusing the one shape that is dangerous: a piece that is exactly `.` or
 * `..`. See `@/tools/url-path` for why rejection rather than encoding is the
 * only mechanism that neutralizes a dot segment.
 *
 * @param value - The raw `objectID`, typically LLM-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The percent-encoded object id, safe to interpolate into a path.
 * @throws If the value is empty, or any `/`-delimited piece is a dot segment.
 */
export function safeAlgoliaObjectId(value: string, paramName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : value

  if (typeof trimmed === 'string' && trimmed.includes('/')) {
    return trimmed
      .split('/')
      .map((piece) => safeUrlPathSegment(piece, paramName))
      .join('%2F')
  }

  return safeUrlPathSegment(trimmed, paramName)
}
