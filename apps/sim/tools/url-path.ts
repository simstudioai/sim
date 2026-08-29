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
 * Tool params are declared `type: 'string'`, but that declaration is not
 * enforced anywhere before the value reaches here: it arrives from an LLM tool
 * call or from stored workflow state, where a numeric-looking id (a Vercel
 * `deploymentId`, a Daytona `sandboxId`) can be serialized as a JSON **number**
 * and stays one. The previous `typeof value === 'string' ? value.trim() : ''`
 * turned any such value into `''`, which the guards then reported as
 * *"<param> is required"* — the least actionable message available for a value
 * the caller did supply, and one that points at the wrong fix.
 *
 * This is not a restoration of prior behaviour. Every call site that predates
 * these guards interpolated `${params.id.trim()}`, so a numeric id threw
 * `TypeError: params.id.trim is not a function` there too. The widening is a
 * deliberate improvement: it accepts what callers actually send, and where it
 * still refuses (below) it says why by name.
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
 * The value is trimmed first: these are opaque, copy-pasted identifiers, so
 * surrounding whitespace is transport noise rather than part of the id, and
 * call sites depend on that. {@link safeUrlPath} deliberately does **not**
 * trim, because a path segment's leading and trailing spaces are legal
 * filename characters and dropping them would address a different file — see
 * the note on that function for the full reasoning.
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

/**
 * Builds a traversal-safe **multi-segment** URL path from a parameter whose
 * value legitimately contains `/`.
 *
 * A few provider parameters address a location *inside* a repository rather
 * than a single resource: GitHub's `path` (`docs/README.md`), `branch`
 * (`feature/my-branch`), and `ref` (`heads/release/2.0`). Passing these through
 * {@link safeUrlPathSegment} would reject every real value, because that guard
 * treats a separator as proof the caller supplied the wrong kind of thing. The
 * split is therefore deliberate and narrow: use `safeUrlPathSegment` unless the
 * provider documents the parameter as a slash-delimited path, and never widen a
 * single-segment id to this helper merely to make a separator stop erroring.
 *
 * Permitting `/` does not weaken the traversal rule, which is enforced per
 * segment: the value is split on `/`, and any segment that is `.` or `..` after
 * trimming is rejected outright for exactly the reason the module note gives —
 * the URL parser removes a dot segment after decoding, so encoding it cannot
 * neutralize it. Each surviving segment is percent-encoded individually, which
 * is what keeps a `?`, `#`, or `%` inside a filename from re-aiming the request
 * or opening a query, while leaving the `/` separators intact.
 *
 * Empty segments are rejected rather than dropped. A `//` or a leading `/`
 * changes what the joined path addresses (a leading `/` in
 * `` `${base}/${value}` `` produces a `//` that the parser keeps), and silently
 * collapsing it would rewrite the caller's value into a different resource.
 * A trailing `/` is rejected on the same ground.
 *
 * **This helper does not trim, and that is the deliberate difference from
 * {@link safeUrlPathSegment}.** The two take opposite positions because their
 * inputs are opposite kinds of thing:
 *
 * - A single-segment id (`ecfg_abc123`, a repo name, a numeric id) is an opaque
 *   token that a human copy-pastes, so surrounding whitespace is transport
 *   noise and `safeUrlPathSegment` strips it. Callers depend on that.
 * - A path is *content*. A leading or trailing space is a legal character in a
 *   filename on every filesystem this addresses, and git stores it verbatim —
 *   `docs/ draft.md` and `docs/draft.md ` are three distinct files alongside
 *   `docs/draft.md`. Trimming here would silently rewrite the caller's path and
 *   read, update, or **delete** a different file than the one requested. That
 *   is a data-integrity bug, and a worse one than the traversal this module
 *   exists to stop, because it succeeds instead of failing.
 *
 * So whitespace inside the value is preserved byte-for-byte and percent-encoded
 * (` ` becomes `%20`), including at the very start and end of the whole
 * parameter, since those positions belong to the first and last filename just
 * as much as any interior one. A caller who pastes a padded path gets a loud
 * 404 for a file that does not exist rather than a quiet success against the
 * wrong one.
 *
 * A segment that is only whitespace is **permitted**, for the same reason the
 * rest of the value is not trimmed, and the temptation to reject it on the
 * grounds that it "names nothing" should be resisted. It names something: git
 * tracks a file and a directory whose entire name is spaces, exactly as typed.
 *
 * ```
 * $ git ls-files | sed -n 'l'   # `l` makes the line ends visible
 * d/   $
 * e/   /f.txt$
 * ```
 *
 * And rejecting it would buy nothing, because a whitespace-only segment is not
 * a dot segment and the parser never removes it — the encoded form survives
 * intact, where a dot segment does not:
 *
 * ```
 * new URL('https://x/a/%20%20%20/b').pathname // => '/a/%20%20%20/b'  (kept)
 * new URL('https://x/a/../b').pathname        // => '/b'              (removed)
 * ```
 *
 * So the check would carry no security value and a real cost: a legitimate file
 * that could not be read, updated, or deleted. Only a *truly* empty component
 * — the `//` case above, where the caller wrote no name at all — is rejected.
 *
 * {@link safeUrlPathSegment} does still reject an all-whitespace value, and
 * that asymmetry is correct rather than an oversight: it trims first, so an
 * opaque id of only spaces really has named nothing.
 *
 * Not trimming also does not weaken the dot-segment check, which compares the
 * raw segment. A space-wrapped dot segment needs no rejection because encoding
 * it makes it inert — the URL parser removes `%2e%2e` but not `%20..%20`:
 *
 * ```
 * new URL('https://x/a/b/%20..%20').pathname // => '/a/b/%20..%20'  (kept)
 * ```
 *
 * A `:` is restored after encoding. It is a legal `pchar` with no delimiter or
 * traversal meaning inside a path segment, and providers use it structurally:
 * GitHub's compare endpoint addresses a cross-fork ref as `owner:branch`, which
 * `encodeURIComponent` would rewrite to `owner%3Abranch`. Nothing else escaped
 * by `encodeURIComponent` is restored.
 *
 * Backslashes are rejected everywhere in the value. They are not path
 * separators for the URL parser, but a value carrying one is a Windows-shaped
 * path that the caller did not mean to address literally, and accepting it
 * would encode `\..\..` into a segment that reads as traversal to any consumer
 * downstream that normalizes it.
 *
 * @param value - The raw path, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed path with every segment percent-encoded and the `/`
 *   separators preserved, safe to interpolate.
 * @throws If the value is not a string or a usable number, is empty, contains
 *   a truly empty segment (a `//`), contains a dot segment, contains a
 *   backslash, or cannot be encoded.
 */
export function safeUrlPath(value: string | number | bigint, paramName: string): string {
  const path = toGuardedString(value, paramName)

  if (!path) {
    throw new Error(`${paramName} is required`)
  }

  if (path.includes('\\')) {
    throw new Error(`${paramName} cannot contain a backslash`)
  }

  return path
    .split('/')
    .map((segment) => {
      if (!segment) {
        throw new Error(`${paramName} cannot contain an empty path segment`)
      }

      if (segment === '.' || segment === '..') {
        throw new Error(
          `${paramName} cannot contain a "${segment}" segment (path traversal is not allowed)`
        )
      }

      return encodeSegment(segment, paramName).replaceAll('%3A', ':')
    })
    .join('/')
}

/**
 * Builds a traversal-safe URL path segment from a parameter whose value may
 * legitimately contain `/` but which the provider still reads as **one** path
 * parameter.
 *
 * This is the third shape, and the narrowest. {@link safeUrlPathSegment} refuses
 * a separator outright; {@link safeUrlPath} keeps separators as structure. Some
 * provider parameters are neither: GitHub label names are commonly namespaced
 * (`area/api`), and `DELETE /repos/{o}/{r}/issues/{n}/labels/{name}` takes the
 * whole label as a single parameter, so the separator must survive as `%2F`
 * rather than as a path boundary. Emitting a real `/` there would address a
 * different endpoint; rejecting it would break a legitimate label.
 *
 * Percent-encoding a separator is safe on its own — the URL parser does not
 * decode `%2F` before removing dot segments, so `a%2F..%2F..` stays put. The
 * one hole encoding cannot close is a value that is *entirely* a dot segment,
 * which is why that case is still rejected here rather than encoded, exactly as
 * the module note requires.
 *
 * Prefer `safeUrlPathSegment`. Reach for this helper only when the provider
 * documents the parameter as a single value that may itself contain `/`.
 *
 * @param value - The raw value, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed value percent-encoded as a single segment, separators
 *   included, safe to interpolate.
 * @throws If the value is not a string or a usable number, is empty, is a dot
 *   segment, or cannot be encoded.
 */
export function safeEncodedUrlPathSegment(
  value: string | number | bigint,
  paramName: string
): string {
  const trimmed = toGuardedString(value, paramName).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  return encodeSegment(trimmed, paramName)
}

/**
 * Rejects a value whose text is surrounded by whitespace.
 *
 * Shared by the strict guards below. Only a string can be padded — a number or
 * bigint has no surrounding text — and a value that is *entirely* whitespace is
 * deliberately allowed through to the wrapped guard, so it reports the more
 * accurate "is required" rather than complaining about padding on a value that
 * has no content at all.
 */
function assertUnpadded(value: string | number | bigint, paramName: string): void {
  if (typeof value !== 'string') return

  const trimmed = value.trim()
  if (trimmed && trimmed !== value) {
    throw new Error(
      `${paramName} must not have leading or trailing whitespace (refusing to guess which resource was meant on a request that changes state)`
    )
  }
}

/**
 * {@link safeUrlPathSegment} for an identifier on a request that **changes
 * state** — a POST, PUT, PATCH, or DELETE.
 *
 * Identical in every respect except one: it refuses a padded value instead of
 * trimming it.
 *
 * The reason is a rule about what a security fix is allowed to change. Before
 * these guards existed, the GitHub tools interpolated identifiers raw, so a
 * padded `owner` reached the provider as `%20%20acme%20%20`, matched no
 * repository, and the request was a 404 no-op. Routing that same value through
 * a *trimming* guard silently converts the no-op into a real mutation:
 *
 * ```
 * before: DELETE /repos/%20%20acme%20%20/sim/git/refs/heads/main -> 404, nothing happens
 * after:  DELETE /repos/acme/sim/git/refs/heads/main             -> the branch is gone
 * ```
 *
 * Nothing about that is traversal, and every traversal test still passes, which
 * is exactly why it would ship unnoticed. So the rule these strict guards
 * encode is: **a hardening change must never turn a failing request into a
 * succeeding one.**
 *
 * This applies only where the change *introduces* the trim. A parameter that
 * already trimmed before the guards landed — the gist tools' `gist_id`, which
 * read `params.gist_id?.trim()` — keeps trimming, because preserving its
 * behaviour is the same rule, not an exception to it.
 *
 * Reads deliberately keep {@link safeUrlPathSegment}. Trimming a padded id on a
 * GET is the copy-paste convenience that helper exists for, and its worst case
 * is returning data the caller can simply ignore — not destroying a branch,
 * closing someone's pull request, or filing an issue in a real repository.
 *
 * @param value - The raw identifier, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The percent-encoded segment, safe to interpolate.
 * @throws Everything {@link safeUrlPathSegment} throws, plus a padded value.
 */
export function strictUrlPathSegment(value: string | number | bigint, paramName: string): string {
  assertUnpadded(value, paramName)
  return safeUrlPathSegment(value, paramName)
}

/**
 * {@link safeEncodedUrlPathSegment} for a state-changing request.
 *
 * Same rule as {@link strictUrlPathSegment}; see that function for why. This
 * variant exists because `remove_label` is a DELETE whose label `name` is one
 * path parameter that may itself contain `/`, so it needs the encoding
 * behaviour of `safeEncodedUrlPathSegment` and the padding refusal together.
 *
 * @param value - The raw value, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The value percent-encoded as a single segment.
 * @throws Everything {@link safeEncodedUrlPathSegment} throws, plus a padded value.
 */
export function strictEncodedUrlPathSegment(
  value: string | number | bigint,
  paramName: string
): string {
  assertUnpadded(value, paramName)
  return safeEncodedUrlPathSegment(value, paramName)
}
