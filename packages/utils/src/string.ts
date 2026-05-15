/**
 * Truncates `str` to at most `maxLength` characters, appending `suffix` when
 * truncation occurs. Defaults to `'...'`.
 *
 * @example
 * truncate('hello world', 8)         // 'hello...'
 * truncate('hello world', 8, ' …')   // 'hello …'
 * truncate('hi', 10)                 // 'hi'
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
  return str.length > maxLength ? str.slice(0, maxLength) + suffix : str
}
