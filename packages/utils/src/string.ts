/**
 * Truncates `str` if it exceeds `sliceLength` characters, appending `suffix`.
 * The total output length when truncated is `sliceLength + suffix.length`.
 * Defaults suffix to `'...'`.
 *
 * @example
 * truncate('hello world', 8)         // 'hello wo...' (11 chars)
 * truncate('hello world', 8, ' …')   // 'hello wo …'
 * truncate('hi', 10)                 // 'hi'
 */
export function truncate(str: string, sliceLength: number, suffix = '...'): string {
  return str.length > sliceLength ? str.slice(0, sliceLength) + suffix : str
}

/**
 * Strips a trailing `_vN` version suffix from `value`, yielding the base type.
 * Only the single trailing suffix is removed; leading occurrences are left intact.
 *
 * @example
 * stripVersionSuffix('notion_search_v2')  // 'notion_search'
 * stripVersionSuffix('x')                 // 'x'
 * stripVersionSuffix('a_v2_v3')           // 'a_v2'
 */
export function stripVersionSuffix(value: string): string {
  return value.replace(/_v\d+$/, '')
}

/**
 * Tests whether `value` ends with a `_vN` version suffix.
 * Only a trailing suffix counts; a leading or embedded `_vN` does not match.
 *
 * @example
 * isVersionedType('notion_search_v2')  // true
 * isVersionedType('plain')             // false
 * isVersionedType('a_version')         // false
 */
export function isVersionedType(value: string): boolean {
  return /_v\d+$/.test(value)
}

/**
 * Normalizes an email address for comparison and storage by trimming
 * surrounding whitespace and lowercasing.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
