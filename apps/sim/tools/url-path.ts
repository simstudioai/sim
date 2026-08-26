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
 * Normalizes an incoming parameter to a trimmed string before it is guarded.
 *
 * Tool params are declared `type: 'string'`, but the value arrives from an LLM
 * tool call or user input and a numeric-looking id (an X `woeid`, a Discord
 * snowflake, a Box `folderId`) can land as a JSON **number**. The previous
 * `typeof value === 'string' ? value.trim() : ''` turned any such value into
 * `''`, which the guards then reported as *"<param> is required"* — a
 * confusing error for a value the caller did supply, and a regression for the
 * call sites whose pre-guard form was a bare `${params.id}` template that
 * stringified a number fine.
 *
 * `String(value)` restores that stringification. `null` and `undefined` are
 * rejected *before* coercion, because `String(null)` is the truthy `'null'`
 * and `String(undefined)` is the truthy `'undefined'` — coercing first would
 * silently address a resource literally named `"null"` instead of reporting a
 * missing value. Every other check runs on the resulting string, so nothing
 * the guards exist for is weakened.
 */
function toGuardedString(value: unknown, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  return String(value).trim()
}

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
 * @param value - The raw identifier, typically LLM- or user-supplied. A number is
 *   stringified, since an LLM can emit a numeric-looking id as a JSON number.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is empty, a dot segment, or contains a path separator.
 */
export function safeUrlPathSegment(value: string | number, paramName: string): string {
  const trimmed = toGuardedString(value, paramName)

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
 * The value is trimmed **as a whole**, split on `/`, and each segment is
 * checked and `encodeURIComponent`-ed before being rejoined with a literal
 * `/`. Slashes therefore survive as separators and are never encoded to
 * `%2F`. See the module note above for why dot segments are rejected rather
 * than encoded.
 *
 * Individual segments are deliberately **not** trimmed. Supabase Storage
 * documents whitespace as a legal object-key character — its server-side
 * `VALID_OBJECT_KEY` regex includes a literal space — so a genuine key like
 * `folder/ report .csv` must reach the provider intact. Per-segment trimming
 * silently rewrote it to `folder/report.csv`, addressing a *different* object
 * and returning a 404 or the wrong file with no error. Silent misaddressing is
 * strictly worse than a rejection.
 *
 * Dropping that trim does not re-open traversal: the WHATWG URL parser only
 * removes a segment that is *exactly* `.` or `..`, and a padded one survives
 * as inert text (`encodeURIComponent(' .. ')` is `'%20..%20'`, which
 * `new URL()` leaves in place). The exact-match check on the untrimmed
 * segment is therefore sufficient, and the whole-value trim still collapses
 * `'  ..  '` to the rejected `'..'`.
 *
 * A segment that is only whitespace (`a/ /b`) is **allowed** — Supabase's
 * charset permits a folder literally named `" "`, it encodes to `%20`, and it
 * is structurally non-empty. Only a genuinely empty segment is rejected, which
 * is what blocks `//`, a leading `/`, and a trailing `/`. Those are rejected
 * rather than stripped because an empty segment means the caller's value was
 * malformed, and guessing which object they meant would make the request ours
 * rather than theirs. (Prefix *listing* is not the reason: `storage_list`
 * sends its prefix in the JSON body, so every caller of this helper addresses
 * a single object.) A caller whose provider normalizes a trailing slash away
 * — GitHub's contents API answers `contents/dir/` with a 302 to `contents/dir`
 * — should strip it at the callsite, where that provider fact is known.
 *
 * @param value - The raw path, typically LLM- or user-supplied. A number is
 *   stringified, since an LLM can emit a numeric-looking id as a JSON number.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The encoded path, with `/` preserved between segments.
 * @throws If the value is empty, contains a `\`, an empty segment, or a dot segment.
 */
export function safeUrlPath(value: string | number, paramName: string): string {
  const trimmed = toGuardedString(value, paramName)

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed.includes('\\')) {
    throw new Error(`${paramName} cannot contain a backslash`)
  }

  return trimmed
    .split('/')
    .map((segment) => {
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
