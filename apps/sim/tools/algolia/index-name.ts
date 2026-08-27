/**
 * Normalization for an Algolia index name that a tool puts into a request
 * **body** rather than into the URL path.
 *
 * The path-zone sites run through `@/tools/url-path`, whose guards already
 * stringify a numeric value before encoding it. That module's contract is
 * path-specific — rejecting dot segments and separators — and a body field
 * needs neither, so the coercion lives here instead of widening the path
 * module's public surface.
 *
 * An index named `2024` is ordinary, and a `visibility: 'user-or-llm'` slot
 * filled with `2024` arrives as a JSON number, where a bare `.trim()` is an
 * unhandled `TypeError: x.trim is not a function`. `null` and `undefined` are
 * rejected before coercion so a missing parameter is reported rather than sent
 * as an index literally named `"undefined"`.
 */

/**
 * Coerces a required Algolia index name to a trimmed string.
 *
 * @param value - The raw index name, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The index name as a trimmed string.
 * @throws If the value is nullish or trims to empty.
 */
export function algoliaIndexName(value: unknown, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  const trimmed = String(value).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  return trimmed
}
