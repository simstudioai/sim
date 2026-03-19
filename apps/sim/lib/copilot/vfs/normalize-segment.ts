/**
 * Normalize a string for use as a single VFS path segment (workflow name, file name, etc.).
 * Applies NFC normalization, trims, strips ASCII control characters, maps `/` to `-`, and
 * collapses Unicode whitespace (including U+202F as in macOS screenshot names) to a single
 * ASCII space.
 */
export function normalizeVfsSegment(name: string): string {
  return name
    .normalize('NFC')
    .trim()
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
}
