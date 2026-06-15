/**
 * Normalizes a free-form token from a webhook payload to a canonical form for
 * matching: trims surrounding whitespace, lowercases, and collapses runs of
 * whitespace or hyphens into single underscores.
 */
export function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}
