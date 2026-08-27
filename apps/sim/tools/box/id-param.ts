/**
 * Normalization for Box resource ids that a tool puts into a request **body**
 * or query string rather than into the URL path.
 *
 * `@/tools/url-path`'s guards already stringify a numeric id before encoding
 * it, but that module's contract is path-specific — it exists to reject dot
 * segments and separators — and the body-zone sites here need neither. They
 * need only the coercion, so they get a local helper rather than a widened
 * public surface on the path module.
 *
 * The coercion matters more for Box than for most providers: Box file and
 * folder ids are literally numeric strings, and `"0"` is the root folder. A
 * `visibility: 'user-or-llm'` slot filled with `0` arrives as a JSON number, so
 * a bare `.trim()` is an unhandled `TypeError: x.trim is not a function` rather
 * than a validation error, and a truthiness test on the same value drops the
 * root folder silently.
 *
 * `null` and `undefined` are rejected *before* coercion, because `String(null)`
 * is the truthy `'null'` — coercing first would address a folder literally
 * named `"null"` instead of reporting a missing value.
 */

/**
 * Coerces a required Box id to a trimmed string.
 *
 * @param value - The raw id, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The id as a trimmed string.
 * @throws If the value is nullish or trims to empty.
 */
export function requiredBoxId(value: unknown, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  const trimmed = String(value).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  return trimmed
}

/**
 * Coerces an optional Box id to a trimmed string, or `undefined` when the
 * caller supplied nothing.
 *
 * The number `0` returns `'0'`: it is the Box root folder, not an absent value.
 * A whitespace-only string returns `undefined` rather than the empty string the
 * previous truthiness test forwarded, so the field is omitted instead of being
 * sent as an id Box cannot resolve.
 *
 * @param value - The raw id, typically LLM- or user-supplied.
 * @returns The trimmed id, or `undefined` when there is nothing to send.
 */
export function optionalBoxId(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  return String(value).trim() || undefined
}
