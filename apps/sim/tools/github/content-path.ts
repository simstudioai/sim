/**
 * Encodes a repository file path for the contents API, keeping its `/`
 * separators. Each segment is percent-encoded so a `#` or `?` in a file name
 * stays part of the path instead of ending it.
 */
export function encodeContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
