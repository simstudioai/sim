/**
 * Traversal-safe construction of URL path components from tool parameters.
 *
 * The rule these helpers encode, stated once for the whole module: **no
 * encoding scheme neutralizes a dot segment — only value rejection does.**
 *
 * `.` and `..` are *unreserved* characters, so `encodeURIComponent('..')`
 * returns `'..'` verbatim. Double-encoding does not help either, because the
 * WHATWG URL parser that `fetch` uses removes the percent-encoded spellings of
 * a dot segment (`%2e`, `%2E`, and every mixed spelling of the two-dot form)
 * just as it removes the literal one:
 *
 * ```
 * new URL('https://x/v1/a/b/..').pathname     // => '/v1/a/'
 * new URL('https://x/v1/a/b/%2e%2e').pathname // => '/v1/a/'  (still removed)
 * ```
 *
 * Only the literal spellings need checking here, and that is not a shortcut:
 * `encodeURIComponent` escapes `%` itself, so a value whose literal text is
 * `%2e%2e` leaves as `%252e%252e` and no encoded spelling can ever be emitted.
 * The check is sufficient *because* every value goes through
 * `encodeURIComponent` — a pass-through for pre-encoded input would have to
 * widen it.
 *
 * A removed segment pops a path segment on a fixed host with the caller's
 * bearer token still attached — including on DELETE routes. These parameters
 * are typically `visibility: 'user-or-llm'`, so prompt injection controls them.
 * Therefore a value that is exactly `.` or `..` after trimming is rejected
 * outright rather than encoded, and no helper here may be "simplified" back to
 * a bare encode.
 *
 * A dot *inside* a longer segment is legitimate and preserved untouched:
 * `example.com`, `my-app.vercel.app`, `..foo`, and `foo..` all pass through.
 */

/**
 * Normalizes an incoming parameter to a string before it is guarded.
 *
 * Trimming is left to the caller, because whether surrounding whitespace is
 * copy-paste noise or part of the value is a per-helper decision.
 *
 * Tool params are declared `type: 'string'`, but the value arrives from an LLM
 * tool call or user input and a numeric-looking id (a Box `folderId`, whose
 * root folder is literally `0`; an X `woeid`) can land as a JSON **number**.
 * The previous `typeof value === 'string' ? value.trim() : ''` turned any such
 * value into `''`, which the guards then reported as *"<param> is required"* —
 * a confusing error for a value the caller did supply, and a regression for
 * the call sites whose pre-guard form was a bare `${params.id}` template that
 * stringified a number fine.
 *
 * An id too large for a `double` — a Discord snowflake, a Twitter id — is
 * **not** in scope here and cannot be: `JSON.parse` destroys the precision
 * before this function is ever reached (`1234567890123456789` becomes
 * `1234567890123456800`). Such an id must arrive as a **string**; nothing this
 * function does can recover one that did not.
 *
 * The accepted set is therefore narrow on purpose — `string`, `number`, and
 * `bigint`, and nothing else. A bare `String(value)` would coerce every other
 * shape into a *plausible but wrong* segment (`{}` into
 * `'%5Bobject%20Object%5D'`, `true` into `'true'`, `[1,2]` into `'1%2C2'`,
 * `new Date(0)` into a 60-character encoded date), producing a 404 from the
 * provider instead of a named error from us. Rejecting them keeps the failure
 * legible and attributable to the caller's input.
 *
 * Three number spellings are rejected even though `typeof` says `'number'`,
 * because their decimal text is not the id the caller meant:
 *
 * - Non-finite (`NaN`, `±Infinity`) — no identifier reading at all.
 * - An integer beyond `Number.MAX_SAFE_INTEGER`, whose decimal text has already
 *   lost digits. That is silent corruption of a large id, which is exactly the
 *   failure mode a caller cannot debug from a 404. Every value large enough to
 *   print exponentially (`1e21` → `'1e+21'`) is an integer double and lands
 *   here, so it keeps this precision message.
 * - A value whose `String()` is exponential without being imprecise — only the
 *   *tiny* magnitudes reach this (`1e-7`, `5e-324`). These do round-trip
 *   exactly, so the precision complaint would be false; they are rejected on
 *   the separate ground that `1e-7` is not a spelling any provider path
 *   accepts as an identifier, and emitting `/v1/trends/1e-7` would rewrite the
 *   caller's `0.0000001` into text they never wrote. The error says so.
 *
 * A plain decimal such as `1.5` is kept: it round-trips through `String`
 * exactly and reads as written, so it is the caller's value verbatim.
 *
 * `null` and `undefined` are rejected *first* and keep the distinct *"is
 * required"* message, because `String(null)` is the truthy `'null'` — coercing
 * would silently address a resource literally named `"null"` — and because
 * "you sent nothing" is a different fix for the caller than "you sent the
 * wrong kind of thing". The type check also runs before any stringification,
 * so an `Object.create(null)` produces this module's named error rather than a
 * bare `TypeError` with the parameter name lost.
 */
function toGuardedString(value: unknown, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${paramName} must be a string or a finite number`)
    }

    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(
        `${paramName} is too large to be represented exactly as a number (pass it as a string)`
      )
    }

    const stringified = String(value)

    if (stringified.includes('e')) {
      throw new Error(
        `${paramName} must be a plain decimal, but ${stringified} is exponential notation (pass it as a string)`
      )
    }

    return stringified
  }

  throw new Error(`${paramName} must be a string or a number (received ${typeof value})`)
}

/**
 * Percent-encodes one segment, keeping this module's named-error contract.
 *
 * `encodeURIComponent` throws a bare `URIError` on an unpaired UTF-16
 * surrogate, and that error names neither the parameter nor the module.
 * Unpaired surrogates are reachable: `JSON.parse` accepts a lone `"\ud83d"`
 * escape, so a truncated emoji in an LLM tool call arrives here as an ordinary
 * string that every check above passes.
 */
function encodeSegment(segment: string, paramName: string): string {
  try {
    return encodeURIComponent(segment)
  } catch {
    throw new Error(`${paramName} contains an unpaired UTF-16 surrogate and cannot be encoded`)
  }
}

/**
 * Builds a single, traversal-safe URL path segment from an identifier that a
 * tool interpolates into a request path.
 *
 * Rejects empty values, dot segments, and any value still carrying a `/` or
 * `\` separator (defense in depth — encoding already neutralizes those, but a
 * separator in a single-segment parameter means the caller passed something
 * other than what the parameter addresses).
 *
 * See the module note above for why rejection, not encoding, is the mechanism.
 *
 * @param value - The raw identifier, typically LLM- or user-supplied. A finite
 *   number or a bigint is stringified, since an LLM can emit a numeric-looking
 *   id as a JSON number; any other non-string kind is rejected by name.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is not a string or a usable number, is empty, is a dot
 *   segment, contains a path separator, or cannot be encoded.
 */
export function safeUrlPathSegment(value: string | number | bigint, paramName: string): string {
  const trimmed = toGuardedString(value, paramName).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`${paramName} cannot contain a path separator`)
  }

  return encodeSegment(trimmed, paramName)
}
