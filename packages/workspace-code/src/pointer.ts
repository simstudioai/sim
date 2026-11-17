/** JSON Pointers (RFC 6901), shared by the declaration reader and the base parser. Client-safe. */

/** One pointer segment, with `~` and `/` escaped. */
export function pointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
}
