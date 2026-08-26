import { validateSupabaseProjectId } from '@/lib/core/security/input-validation'
import { safeUrlPath, safeUrlPathSegment } from '@/tools/url-path'

/**
 * Returns the validated Supabase REST API base URL for a given project ID.
 * Throws if the project ID contains characters that could alter the URL
 * (e.g. `#`, `/`, `@`), preventing SSRF via fragment injection.
 */
export function supabaseBaseUrl(projectId: string): string {
  const result = validateSupabaseProjectId(projectId)
  if (!result.isValid) {
    throw new Error(result.error)
  }
  return `https://${result.sanitized}.supabase.co`
}

/**
 * Builds a single storage path segment (a bucket name) for interpolation into
 * a URL, trimming copy-paste whitespace first.
 *
 * Delegates to `safeUrlPathSegment`, so a value that is exactly `.` or `..`,
 * or that carries a path separator, is rejected rather than encoded — see the
 * module note in `@/tools/url-path` for why encoding alone cannot neutralize a
 * dot segment.
 */
export function encodeStorageSegment(segment: string, paramName = 'bucket'): string {
  return safeUrlPathSegment(segment, paramName)
}

/**
 * Relaxations Supabase Storage keys genuinely need, applied at this one call
 * site rather than to every consumer of the shared helper.
 *
 * Supabase's server-side key allowlist is, verbatim
 * (`supabase/storage`, `src/storage/limits.ts`):
 *
 * ```js
 * const VALID_OBJECT_KEY = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/
 * ```
 *
 * `/` is unrestricted and never collapsed, so `a//b`, `/leading`, and
 * `trailing/` are all legal keys the URL parser preserves byte-for-byte. A
 * literal space is in the charset and the server never trims, so
 * `' report.csv'` is a *different* object from `'report.csv'`.
 */
const STORAGE_PATH_OPTIONS = {
  allowEmptySegments: true,
  preserveOuterWhitespace: true,
} as const

/**
 * Builds a storage object path for use inside a URL, preserving `/` as a path
 * separator while encoding each segment so spaces, `#`, `?`, and other
 * reserved characters in file names don't corrupt the request.
 *
 * Delegates to `safeUrlPath` with {@link STORAGE_PATH_OPTIONS}: encoding each
 * segment *reads* as sanitization but maps `'../..'` straight through, because
 * `encodeURIComponent('..')` is `'..'`. Dot segments and backslashes are
 * therefore still rejected — that check is exact-match, so allowing empty
 * segments and outer whitespace cannot re-open traversal.
 *
 * The shared helper is *called*, not re-implemented, so its `null`/`undefined`
 * rejection and its number coercion (an LLM can emit a numeric-looking key as
 * a JSON number) apply here unchanged.
 */
export function encodeStoragePath(path: string, paramName = 'path'): string {
  return safeUrlPath(path, paramName, STORAGE_PATH_OPTIONS)
}

/**
 * The only character that can terminate a URL query string. `fetch` never
 * transmits a fragment, so anything from here on is dropped before the request
 * leaves the process.
 */
const QUERY_TERMINATOR = '#'

/**
 * Guards a raw PostgREST query-string fragment that a tool appends verbatim
 * after `?select=...`, and returns it trimmed.
 *
 * `filter` is not an opaque value — it is already query-string *syntax*
 * (`id=eq.123`, `age=gt.18&status=eq.active`, `or=(a.eq.1,b.eq.2)`,
 * `category=in.(tech,science)`, `email=ilike.*@gmail.com`), which is why it is
 * interpolated raw. Two encoding strategies were rejected before this one:
 *
 * - **Blanket `encodeURIComponent`** destroys the `=` and `&` the expression
 *   is built from, so no filter would parse at all.
 * - **Round-tripping through `URLSearchParams`** changes bytes on the wire for
 *   most documented spellings — `and=(a.eq.1,b.gt.2)` re-serializes as
 *   `and=%28a.eq.1%2Cb.gt.2%29` and `e=eq.a%20b` as `e=eq.a+b`. Those very
 *   likely still parse, but "very likely" is not a guarantee worth making
 *   about a `DELETE`, and the whole point of this guard is that a filter must
 *   never silently mean something other than what the caller wrote.
 *
 * Rejection is used instead, and it is *complete*: `#` is the only character
 * that can end a query string, so it is the entire attack surface. It is also
 * *lossless* — because `fetch` drops the fragment, no filter containing `#`
 * has ever reached PostgREST. Every such filter is already broken today, just
 * silently: `'?select=*&' + '#id=eq.1'` transmits the search `'?select=*&'`
 * (filter gone) and `'name=eq.J#ohn'` transmits `'?select=*&name=eq.J'`
 * (filter widened). On `supabase_delete` and `supabase_update` that is an
 * unfiltered `DELETE`/`PATCH` against the whole table. Rejecting turns silent
 * data loss into an error and cannot break a filter that works today.
 *
 * @param filter - The raw PostgREST fragment, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The trimmed fragment, safe to append after an existing `&`.
 * @throws If the fragment is empty or contains `#`.
 */
export function safeQueryFragment(filter: string, paramName = 'filter'): string {
  const trimmed = typeof filter === 'string' ? filter.trim() : String(filter ?? '').trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  if (trimmed.includes(QUERY_TERMINATOR)) {
    throw new Error(
      `${paramName} cannot contain "${QUERY_TERMINATOR}" — it opens a URL fragment, which fetch never sends, silently dropping or widening the filter`
    )
  }

  return trimmed
}
