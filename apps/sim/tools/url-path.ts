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
 * Normalizes an incoming parameter to a string before it is guarded.
 *
 * Trimming is left to the caller, because whether surrounding whitespace is
 * copy-paste noise or part of the value is a per-helper decision.
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

  return String(value)
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
   * objects. The WHATWG URL parser preserves each of them verbatim — it only
   * removes a segment that is *exactly* `.` or `..` — so allowing them does
   * not re-open traversal.
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
 * Dropping that trim does not re-open traversal: the WHATWG URL parser only
 * removes a segment that is *exactly* `.` or `..`, and a padded one survives
 * as inert text (`encodeURIComponent(' .. ')` is `'%20..%20'`, which
 * `new URL()` leaves in place). The exact-match check on the untrimmed
 * segment is therefore sufficient.
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
 * @param value - The raw path, typically LLM- or user-supplied. A number is
 *   stringified, since an LLM can emit a numeric-looking id as a JSON number.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @param options - Opt-in relaxations; see {@link SafeUrlPathOptions}. Omitted
 *   or `{}` yields the strict default every non-storage caller relies on.
 * @returns The encoded path, with `/` preserved between segments.
 * @throws If the value is empty, contains a `\`, a dot segment, or (by
 *   default) an empty segment.
 */
export function safeUrlPath(
  value: string | number,
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
 * rejects a `/` outright, which turns a legal id into a hard failure;
 * {@link safeUrlPath} emits the `/` as a real separator, which addresses a
 * *different* route. This helper takes the third position: reject only a value
 * that is exactly `.` or `..`, then `encodeURIComponent` everything else, so
 * `/` becomes `%2F` and the whole value collapses into one inert segment.
 *
 * Encoding-everything is safe precisely because the dot-segment case is
 * rejected first. `encodeURIComponent('a/../b')` is `'a%2F..%2Fb'` — a single
 * segment whose text merely *contains* dots, which the WHATWG URL parser leaves
 * untouched because it only removes a segment that is exactly `.` or `..`. The
 * rejection cannot be dropped: `encodeURIComponent('..')` returns `'..'`
 * verbatim, and `new URL('https://x/1/indexes/idx/..').pathname` is
 * `'/1/indexes/'` — popping the parent segment too, not just the record.
 *
 * Motivating case: an Algolia `objectID`. Algolia validates charset when it
 * means to — `GET /1/indexes/instant%2Fsearch/settings` answers
 * `400 indexName is not valid` — but a slashed or URL-shaped objectID answers
 * `404 ObjectID does not exist`, i.e. the route matched and the id was accepted
 * as well-formed. The OpenAPI declares `objectID` as a bare `type: string` with
 * no `pattern` while constraining `userID` with one in the same file, the
 * official JS client `encodeURIComponent`s it into the segment, and Algolia's
 * own conformance suite exercises `Batman and Robin` →
 * `/1/indexes/cts_e2e_browse/Batman%20and%20Robin` at 200. URL-keyed object ids
 * are a common site-search pattern.
 *
 * Use this only where the provider genuinely documents the parameter as an
 * opaque string. A parameter that names a resource (an index, a bucket, a
 * repository) should keep {@link safeUrlPathSegment}, where a stray separator
 * signals the caller passed the wrong thing.
 *
 * @param value - The raw identifier, typically LLM- or user-supplied. A number is
 *   stringified, since an LLM can emit a numeric-looking id as a JSON number.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed, fully percent-encoded segment, `/` included.
 * @throws If the value is empty or is exactly `.` or `..`.
 */
export function safeOpaqueUrlSegment(value: string | number, paramName: string): string {
  const trimmed = toGuardedString(value, paramName).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }

  return encodeURIComponent(trimmed)
}
