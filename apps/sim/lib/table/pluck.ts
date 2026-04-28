/**
 * Pure utility for plucking a dot-and-bracket path from a value.
 *
 * Lives in its own leaf file (no server-only imports) so client components
 * can import it without dragging in the rest of `lib/table` (which transitively
 * pulls `@sim/db` and `next/headers`).
 */

/**
 * Walk a dot-and-bracket path into a value (e.g. `a.b[0].c` or `result.items.0`).
 * Returns undefined for any missing segment.
 */
export function pluckByPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined || !path) return source
  const segments = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cursor: unknown = source
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}
