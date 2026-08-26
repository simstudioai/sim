import { safeUrlPath } from '@/tools/url-path'

/**
 * Builds a traversal-safe repository file or directory path for the GitHub
 * contents API, tolerating a single trailing `/`.
 *
 * `safeUrlPath` rejects a trailing slash because an empty segment usually means
 * the caller's value was malformed. On the contents API it does not: GitHub
 * normalizes the slash away itself, answering `/contents/packages/` with a
 * `302` whose `Location` is the slash-free `/contents/packages`, which `fetch`
 * follows to the same `200` the bare form returns. The two spellings address
 * the identical resource, so rejecting one is a false rejection — and these
 * params are `visibility: 'user-or-llm'` and documented as directory paths, so
 * a model writing `src/components/` is the natural case.
 *
 * Only one trailing slash is stripped, and only here: `a//b`, a leading `/`,
 * and `a///` still reach `safeUrlPath` with an empty segment and are still
 * rejected, as are `.` and `..` segments. Stripping at this callsite rather
 * than in the helper keeps the provider-specific normalization next to the
 * provider that performs it.
 *
 * @param value - The raw repository path, typically LLM- or user-supplied.
 * @param paramName - The parameter name, used to name the offender in errors.
 * @returns The encoded path, with `/` preserved between segments.
 */
export function safeGithubContentsPath(value: string, paramName: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withoutTrailingSlash = raw.endsWith('/') ? raw.slice(0, -1) : raw

  return safeUrlPath(withoutTrailingSlash, paramName)
}
