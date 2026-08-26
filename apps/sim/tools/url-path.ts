/**
 * Traversal-safe construction of URL path components from tool parameters.
 *
 * The rule these helpers encode, stated once for the whole module: **no
 * encoding scheme neutralizes a dot segment — only value rejection does.**
 *
 * `.` and `..` are *unreserved* characters, so `encodeURIComponent('..')`
 * returns `'..'` verbatim. Double-encoding does not help either, because the
 * WHATWG URL parser that `fetch` uses applies RFC 3986 dot-segment removal
 * *after* percent-decoding:
 *
 * ```
 * new URL('https://x/v1/a/b/..').pathname     // => '/v1/a/'
 * new URL('https://x/v1/a/b/%2e%2e').pathname // => '/v1/a/'  (still removed)
 * ```
 *
 * That pops a path segment on a fixed host with the caller's bearer token
 * still attached — including on DELETE routes. These parameters are typically
 * `visibility: 'user-or-llm'`, so prompt injection controls them. Therefore a
 * value that is exactly `.` or `..` after trimming is rejected outright rather
 * than encoded, and no helper here may be "simplified" back to a bare encode.
 *
 * A dot *inside* a longer segment is legitimate and preserved untouched:
 * `example.com`, `my-app.vercel.app`, `..foo`, and `foo..` all pass through.
 */

/**
 * Builds a single, traversal-safe URL path segment from an identifier that a
 * tool interpolates into a request path.
 *
 * Rejects empty values, dot segments, and any value still carrying a `/` or
 * `\` separator (defense in depth — encoding already neutralizes those, but a
 * separator in a single-segment parameter means the caller passed something
 * other than what the parameter addresses). Use {@link safeUrlPath} for
 * parameters that legitimately span multiple segments.
 *
 * See the module note above for why rejection, not encoding, is the mechanism.
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

/**
 * Builds a traversal-safe, multi-segment URL path from a parameter that
 * legitimately carries `/` separators — a storage object path
 * (`folder/file.jpg`) or a repository file path (`src/lib/foo.ts`).
 *
 * The value is trimmed as a whole, split on `/`, and each segment is trimmed,
 * checked, and `encodeURIComponent`-ed before being rejoined with a literal
 * `/`. Slashes therefore survive as separators and are never encoded to
 * `%2F`. See the module note above for why dot segments are rejected rather
 * than encoded.
 *
 * Empty segments are rejected, which also rejects `//`, a leading `/`, and a
 * trailing `/`. Those are **rejected rather than stripped on purpose**:
 * `bucket/dir/` addresses a prefix listing where `bucket/dir` addresses an
 * object, so silently rewriting the value would change what the caller asked
 * for. Failing loudly keeps the request the caller's, not ours.
 *
 * @param value - The raw path, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The encoded path, with `/` preserved between segments.
 * @throws If the value is empty, contains a `\`, an empty segment, or a dot segment.
 */
export function safeUrlPath(value: string, paramName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed.includes('\\')) {
    throw new Error(`${paramName} cannot contain a backslash`)
  }

  return trimmed
    .split('/')
    .map((rawSegment) => {
      const segment = rawSegment.trim()

      if (!segment) {
        throw new Error(
          `${paramName} cannot contain an empty path segment (no leading, trailing, or repeated "/")`
        )
      }

      if (segment === '.' || segment === '..') {
        throw new Error(
          `${paramName} cannot contain a "${segment}" segment (path traversal is not allowed)`
        )
      }

      return encodeURIComponent(segment)
    })
    .join('/')
}
