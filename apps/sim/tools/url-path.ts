/**
 * Builds a single, traversal-safe URL path segment from an identifier that a
 * tool interpolates into a request path.
 *
 * `encodeURIComponent` alone is NOT sufficient, and this is the whole reason
 * this helper exists — do not "simplify" it back to a bare encode. `.` and `..`
 * are *unreserved* characters, so `encodeURIComponent('..') === '..'` and
 * `encodeURIComponent('.') === '.'`. The WHATWG URL parser that `fetch` uses
 * then applies RFC 3986 dot-segment removal, so the segment is normalized away
 * *after* encoding:
 *
 * ```
 * new URL('https://api.vercel.com/v1/global-config/../items').pathname
 *   // => '/v1/items'
 * new URL('https://proxy.app.daytona.io/toolbox/../files/upload-v2').pathname
 *   // => '/files/upload-v2'
 * ```
 *
 * That pops exactly one path segment on a fixed host with the caller's bearer
 * token still attached — including on DELETE routes. Multi-level traversal
 * (`../..`) is already blocked by encoding because the inner `/` becomes
 * `%2F`, but the single-segment case is not. These IDs are
 * `visibility: 'user-or-llm'`, so prompt injection controls them.
 *
 * A value that is exactly `.` or `..` after trimming is therefore rejected
 * outright, as are empty values and any value still carrying a `/` or `\`
 * separator (defense in depth — encoding already neutralizes those).
 *
 * Note that a dot *inside* a longer segment is legitimate and preserved:
 * `example.com`, `my-app.vercel.app`, and `..foo` all pass through untouched.
 *
 * @param value - The raw identifier, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is empty, a dot segment, or contains a path separator.
 */
export function safeUrlPathSegment(value: string, paramName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`${paramName} cannot contain a path separator`)
  }

  return encodeURIComponent(trimmed)
}
