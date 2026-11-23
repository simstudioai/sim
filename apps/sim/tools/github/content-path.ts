/**
 * Encodes a repository file path for the contents API, keeping its `/`
 * separators. Each segment is percent-encoded so a `#` or `?` in a file name
 * stays part of the path instead of ending it. A `.` segment is dropped, as the
 * URL parser would drop it anyway; a `..` segment is rejected because it would
 * resolve out of `/contents/` into a different repository endpoint.
 *
 * @throws When the path contains a `..` segment.
 */
export function encodeContentPath(path: string): string {
  const segments = path.split('/')
  if (segments.includes('..')) {
    throw new Error('GitHub file path cannot contain ".." segments')
  }
  return segments
    .filter((segment) => segment !== '.')
    .map(encodeURIComponent)
    .join('/')
}
