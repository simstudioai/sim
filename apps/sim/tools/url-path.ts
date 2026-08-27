/**
 * Traversal-safe construction of URL path components from tool parameters.
 *
 * The rule these helpers encode, stated once for the whole module: **no
 * encoding scheme neutralizes a dot segment — only value rejection does.**
 *
 * `.` and `..` are *unreserved* characters, so `encodeURIComponent('..')`
 * returns `'..'` verbatim. Double-encoding does not help either, because the
 * WHATWG URL parser that `fetch` uses recognizes the percent-encoded spellings
 * of a dot segment as well as the literal one — the URL Standard §4.1 defines
 * eleven removable spellings (`.`, `%2e`, `%2E`, `..`, and every `.`/`%2e`
 * combination of the two-dot form), and the parser honors all of them:
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
 * Two number spellings are rejected even though `typeof` says `'number'`,
 * because their decimal text is not the id the caller meant:
 *
 * - Non-finite (`NaN`, `±Infinity`) — no identifier reading at all.
 * - Any value whose `String()` is exponential (`1e21` → `'1e+21'`), and any
 *   integer beyond `Number.MAX_SAFE_INTEGER`, where the decimal text has
 *   already lost digits. Both are silent corruption of a large id, which is
 *   exactly the failure mode a caller cannot debug from a 404. A plain decimal
 *   such as `1.5` is kept: it round-trips through `String` exactly, so it is
 *   the caller's value verbatim, not a rewrite of it.
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

    const stringified = String(value)

    if (stringified.includes('e') || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error(
        `${paramName} is too large to be represented exactly as a number (pass it as a string)`
      )
    }

    return stringified
  }

  throw new Error(`${paramName} must be a string or a number (received ${typeof value})`)
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
 * @param value - The raw identifier, typically LLM- or user-supplied. A finite
 *   number or a bigint is stringified, since an LLM can emit a numeric-looking
 *   id as a JSON number; any other non-string kind is rejected by name.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, percent-encoded segment, safe to interpolate.
 * @throws If the value is not a string or a usable number, is empty, is a dot
 *   segment, or contains a path separator.
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

  return encodeURIComponent(trimmed)
}

/**
 * Opt-in relaxations for {@link safeUrlPath}.
 *
 * Both default to `false`, so every existing call site keeps byte-identical
 * behavior. They exist because one provider — Supabase Storage — documents an
 * object-key charset that is genuinely wider than a conventional file path,
 * and encoding a key the provider considers legal into a *different* key is
 * silent misaddressing. Only that call site opts in; a repository file path or
 * an API resource path still gets the strict form.
 */
export interface SafeUrlPathOptions {
  /**
   * Permit structurally empty segments — a leading `/`, a trailing `/`, and a
   * repeated `//`.
   *
   * Supabase Storage's server-side key allowlist
   * (`/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/`, `supabase/storage`
   * `src/storage/limits.ts`) permits `/` freely and never collapses runs of
   * it, so `a//b`, `/leading`, and `trailing/` are all real, addressable
   * objects. The WHATWG URL parser preserves each of them verbatim: the only
   * segments it removes are the dot segments, and an empty segment is not one
   * of them. So allowing them does not re-open traversal.
   *
   * **The output is only safe under template interpolation** —
   * `` `${base}/bucket/${safeUrlPath(key, 'key', { allowEmptySegments: true })}` ``,
   * which is the shape every call site of this helper uses. It must **not** be
   * handed to `new URL(result, base)`: a leading `/` makes the result
   * host-absolute and discards the entire fixed path prefix, and a value
   * starting `//` is parsed as a protocol-relative URL, so `//evil.com/x`
   * changes the *host*. Neither is reachable today — this option has no
   * callers and no existing call site uses the `new URL(relative, base)`
   * shape — but a future one that does must keep this option off, or reject a
   * leading `/` at the callsite first.
   */
  allowEmptySegments?: boolean

  /**
   * Skip the whole-value trim, so leading and trailing whitespace is treated
   * as part of the value rather than as copy-paste noise.
   *
   * A literal space is inside Supabase's key charset and its server never
   * trims, which makes `' report.csv'` a different object from
   * `'report.csv'`. Trimming addressed the wrong object with no error. The
   * default trim is retained for every other caller, where a value pasted with
   * a stray space is far more likely to be noise than a name.
   */
  preserveOuterWhitespace?: boolean
}

/**
 * Builds a traversal-safe, multi-segment URL path from a parameter that
 * legitimately carries `/` separators — a storage object path
 * (`folder/file.jpg`) or a repository file path (`src/lib/foo.ts`).
 *
 * The value is trimmed **as a whole** (unless
 * {@link SafeUrlPathOptions.preserveOuterWhitespace} is set), split on `/`,
 * and each segment is checked and `encodeURIComponent`-ed before being
 * rejoined with a literal `/`. Slashes therefore survive as separators and are
 * never encoded to `%2F`. See the module note above for why dot segments are
 * rejected rather than encoded.
 *
 * Individual segments are deliberately **not** trimmed. Supabase Storage
 * documents whitespace as a legal object-key character — its server-side
 * `VALID_OBJECT_KEY` regex includes a literal space — so a genuine key like
 * `folder/ report .csv` must reach the provider intact. Per-segment trimming
 * silently rewrote it to `folder/report.csv`, addressing a *different* object
 * and returning a 404 or the wrong file with no error. Silent misaddressing is
 * strictly worse than a rejection.
 *
 * Dropping that trim does not re-open traversal. The WHATWG URL parser removes
 * a segment only when the *whole* segment spells a dot segment — literally or
 * percent-encoded — and a padded one spells neither: `encodeURIComponent(' .. ')`
 * is `'%20..%20'`, which `new URL()` leaves in place. The percent-encoded
 * spellings (`%2e`, `%2e%2e`, …) are unreachable from here for a separate
 * reason: `encodeURIComponent` escapes `%` itself, so a segment of literal
 * text `%2e%2e` leaves as `%252e%252e`, which the parser does not remove. The
 * exact-match check on the untrimmed segment is therefore sufficient — but
 * only while every segment goes through `encodeURIComponent`. A pass-through
 * for pre-encoded input would need the check widened to the encoded spellings.
 *
 * A segment that is only whitespace (`a/ /b`) is **allowed** — Supabase's
 * charset permits a folder literally named `" "`, it encodes to `%20`, and it
 * is structurally non-empty. By default a genuinely *empty* segment is
 * rejected, which is what blocks `//`, a leading `/`, and a trailing `/`:
 * for most providers an empty segment means the caller's value was malformed,
 * and guessing which resource they meant would make the request ours rather
 * than theirs. A provider whose key charset genuinely admits those spellings
 * opts in via {@link SafeUrlPathOptions.allowEmptySegments}. (Prefix *listing*
 * is not the reason: `storage_list` sends its prefix in the JSON body, so
 * every caller of this helper addresses a single object.) A caller whose
 * provider normalizes a trailing slash away — GitHub's contents API answers
 * `contents/dir/` with a 302 to `contents/dir` — should strip it at the
 * callsite, where that provider fact is known.
 *
 * @param value - The raw path, typically LLM- or user-supplied. A finite number
 *   or a bigint is stringified, since an LLM can emit a numeric-looking id as
 *   a JSON number; any other non-string kind is rejected by name.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @param options - Opt-in relaxations; see {@link SafeUrlPathOptions}. Omitted
 *   or `{}` yields the strict default every non-storage caller relies on.
 * @returns The encoded path, with `/` preserved between segments.
 * @throws If the value is not a string or a usable number, is empty, contains a
 *   `\`, a dot segment, or (by default) an empty segment.
 */
export function safeUrlPath(
  value: string | number | bigint,
  paramName: string,
  options: SafeUrlPathOptions = {}
): string {
  const raw = toGuardedString(value, paramName)
  const normalized = options.preserveOuterWhitespace ? raw : raw.trim()

  if (!normalized) {
    throw new Error(`${paramName} is required`)
  }

  if (normalized.includes('\\')) {
    throw new Error(`${paramName} cannot contain a backslash`)
  }

  return normalized
    .split('/')
    .map((segment) => {
      if (!segment) {
        if (!options.allowEmptySegments) {
          throw new Error(
            `${paramName} cannot contain an empty path segment (no leading, trailing, or repeated "/")`
          )
        }
        return segment
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

/**
 * Builds a single, traversal-safe URL path segment from an **opaque** identifier
 * — one the provider treats as an arbitrary string, where a `/` is a legal
 * character of the id rather than a separator.
 *
 * Neither of the helpers above fits that shape. {@link safeUrlPathSegment}
 * rejects a `/` — and a `\`, which this helper instead encodes to `%5C`, so
 * the two differ on both separators, not only on `/` — which turns a legal id
 * into a hard failure;
 * {@link safeUrlPath} emits the `/` as a real separator, which addresses a
 * *different* route. This helper takes the third position: reject only a value
 * that is exactly `.` or `..`, then `encodeURIComponent` everything else, so
 * `/` becomes `%2F` and the whole value collapses into one inert segment.
 *
 * Encoding-everything is safe precisely because the dot-segment case is
 * rejected first. `encodeURIComponent('a/../b')` is `'a%2F..%2Fb'` — a single
 * segment whose text merely *contains* dots, which the WHATWG URL parser leaves
 * untouched because it removes a segment only when the whole segment spells a
 * dot segment. The percent-encoded spellings the parser also removes (`%2e`,
 * `%2e%2e`, …) cannot be produced here, because `encodeURIComponent` escapes
 * `%` itself: a value of literal text `%2e%2e` leaves as `%252e%252e`. The
 * rejection cannot be dropped: `encodeURIComponent('..')` returns `'..'`
 * verbatim, and `new URL('https://x/1/indexes/idx/..').pathname` is
 * `'/1/indexes/'` — popping the parent segment too, not just the record.
 *
 * Motivating case: an Algolia `objectID`. Three things in Algolia's own
 * published sources say the id is opaque:
 *
 * - The OpenAPI declares `objectID` as a bare `type: string` with no `pattern`,
 *   while constraining `userID` in the same bundled spec
 *   (`specs/bundled/search.yml`) with `^[a-zA-Z0-9 \-*.]+$` — a pattern that
 *   excludes `/`. Where Algolia means to restrict a charset, it says so.
 * - The official JS client `encodeURIComponent`s `objectID` into the segment
 *   (`client-search/src/searchClient.ts`).
 * - Algolia's client conformance suite round-trips characters that would
 *   otherwise reshape the path as single encoded segments: a space on a record
 *   id (`Batman and Robin` → `/1/indexes/cts_e2e_browse/Batman%20and%20Robin`,
 *   200) and a literal slash on the rules `objectID`
 *   (`test/with/slash` → `/1/indexes/indexName/rules/test%2Fwith%2Fslash`).
 *   Note the split: the *record*-id case exercises a space, not a slash; the
 *   slash case is the rules route, which takes an id under the same parameter
 *   name.
 *
 * A live probe (no credentials, no artifact in this repo, unreproduced here)
 * suggested Algolia charset-validates `indexName` where it does not validate
 * `objectID` — `GET /1/indexes/instant%2Fsearch/settings` answering
 * `400 indexName is not valid` against a slashed objectID's
 * `404 ObjectID does not exist`. Treat that as unverified: the spec does not
 * corroborate it, since `indexName` is a bare `type: string` with no `pattern`
 * either. Nothing above depends on it. URL-keyed object ids are a common
 * site-search pattern.
 *
 * Use this only where the provider genuinely documents the parameter as an
 * opaque string. A parameter that names a resource (an index, a bucket, a
 * repository) should keep {@link safeUrlPathSegment}, where a stray separator
 * signals the caller passed the wrong thing.
 *
 * @param value - The raw identifier, typically LLM- or user-supplied. A finite
 *   number or a bigint is stringified, since an LLM can emit a numeric-looking
 *   id as a JSON number; any other non-string kind is rejected by name.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, fully percent-encoded segment, `/` included.
 * @throws If the value is not a string or a usable number, is empty, or is
 *   exactly `.` or `..`.
 */
export function safeOpaqueUrlSegment(value: string | number | bigint, paramName: string): string {
  const trimmed = toGuardedString(value, paramName).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  return encodeURIComponent(trimmed)
}
