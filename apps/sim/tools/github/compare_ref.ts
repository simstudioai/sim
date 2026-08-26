import { safeUrlPath } from '@/tools/url-path'

/**
 * Builds a traversal-safe `base` or `head` value for GitHub's compare endpoint,
 * where two parameters share one path segment as `{base}...{head}`.
 *
 * Neither shared helper fits that shape on its own. `safeUrlPathSegment` would
 * reject the `/` a git ref legitimately carries; `safeUrlPath` would emit that
 * `/` as a literal separator, and a literal separator is precisely the hole —
 * `base = '../../../../user/repos?visibility=private&x='` made `new URL()`
 * apply RFC 3986 dot-segment removal and re-aim the request at
 * `https://api.github.com/user/repos?visibility=private`, an arbitrary
 * authenticated GET carrying the caller's PAT whose body `compareCommitsV2Tool`
 * then returns verbatim. `owner` and `repo` do not pin the request: the same
 * normalization pops them off.
 *
 * So the value is delegated to `safeUrlPath` — which trims, coerces a numeric
 * ref to a string, rejects backslashes, empty segments, and `.`/`..` segments,
 * and percent-encodes everything else — and its literal `/` separators are then
 * escaped to `%2F` so the whole value collapses into one inert segment. The
 * helper's checks are composed, never re-implemented; a local re-spelling of
 * them previously dropped its numeric coercion.
 *
 * Encoding loses no documented spelling. GitHub percent-decodes this segment
 * fully, verified live against `immich-app/immich`:
 *
 * - `compare/main...bugfix%2Flive-photo-stuck` → `200` (slashed ref)
 * - `compare/main...immich-app%3Amain` → `200` (cross-fork `USERNAME:BASE`)
 * - `compare/main...immich-app%3Aimmich%3Amain` → `200` (three-part form)
 *
 * The `...` joining the two values stays literal at the callsite; only the
 * values themselves pass through here.
 *
 * @param value - The raw ref, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The fully encoded ref, safe to interpolate around a literal `...`.
 * @throws If the value is empty, a dot segment, or otherwise malformed.
 */
export function safeGithubCompareRef(value: string | number, paramName: string): string {
  return safeUrlPath(value, paramName).replaceAll('/', '%2F')
}
