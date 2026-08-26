import { safeUrlPath } from '@/tools/url-path'

/**
 * Builds a traversal-safe repository file or directory path for the GitHub
 * contents API, tolerating a single leading and a single trailing `/`.
 *
 * `safeUrlPath` rejects both because an empty segment usually means the
 * caller's value was malformed. On the contents API it does not — GitHub
 * normalizes either spelling away itself, verified live against
 * `immich-app/immich`:
 *
 * - `contents/server/` → `302` to `contents/server`, which `fetch` follows to
 *   the same `200` the bare form returns.
 * - `contents//server` → `200` directly; the leading empty segment is dropped.
 *
 * The two spellings address the identical resource, so rejecting one is a
 * false rejection — and these params are `visibility: 'user-or-llm'` and
 * documented as repository paths, so a model writing `src/components/` or the
 * repo-absolute `/src/index.ts` is the natural case.
 *
 * Exactly one slash is stripped from each end, and only here. An *interior*
 * `//` is a genuine 404 on this API, so `a//b` still reaches `safeUrlPath`
 * with an empty segment and is still rejected, as are `//a`, `a//`, and `.`
 * and `..` segments. Stripping at this callsite rather than in the helper
 * keeps the provider-specific normalization next to the provider that performs
 * it.
 *
 * @param value - The raw repository path, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The encoded path, with `/` preserved between segments.
 */
export function safeGithubContentsPath(value: string, paramName: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withoutTrailingSlash = raw.endsWith('/') ? raw.slice(0, -1) : raw
  const withoutOuterSlashes = withoutTrailingSlash.startsWith('/')
    ? withoutTrailingSlash.slice(1)
    : withoutTrailingSlash

  return safeUrlPath(withoutOuterSlashes, paramName)
}
