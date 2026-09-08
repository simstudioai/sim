/**
 * Extracts the `cursor` query value from a relative `_links.next` URL. Both the
 * v2 endpoints and the v1 CQL search return the next page as a relative path
 * carrying an opaque cursor, so the value has to be parsed back out rather than
 * derived.
 *
 * A leaf of its own because both the content listing and the permission
 * listings page the same way, and a second parser that read a link slightly
 * differently would silently stop paginating.
 */
export function extractCursor(nextLink: unknown): string | undefined {
  if (typeof nextLink !== 'string' || !nextLink) return undefined
  try {
    return new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
  } catch {
    return undefined
  }
}
