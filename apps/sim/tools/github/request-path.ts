import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Percent-escapes that `encodeURIComponent` emits for characters which cannot
 * change a URL's structure and which `fetch` sends raw in a path: RFC 3986
 * `sub-delims`, `:`, `@`, and the `[`, `]` and `|` the WHATWG parser leaves raw.
 * Restoring them keeps an identifier that was interpolated raw before byte
 * identical: a branch such as `release+1` or a workflow file such as
 * `deploy@v2.yml` still produces the same URL.
 */
const RAW_SAFE_PATH_ESCAPES = /%(?:24|26|2B|2C|3A|3B|3D|40|5B|5D|7C)/g

function restoreRawSafeCharacters(encoded: string): string {
  return encoded.replace(RAW_SAFE_PATH_ESCAPES, (sequence) => decodeURIComponent(sequence))
}

/**
 * Encodes the `{owner}/{repo}` pair of a GitHub REST path. GitHub names only
 * use `[A-Za-z0-9-_.]`, so every real name passes through unchanged; a value
 * carrying `/`, `?`, `#`, or a dot segment, which would steer the
 * authenticated request to a different endpoint, is rejected or escaped.
 *
 * @throws When either value is empty, a dot segment, or contains a separator.
 */
export function githubRepoPath(owner: string, repo: string): string {
  return `${safeUrlPathSegment(owner, 'owner')}/${safeUrlPathSegment(repo, 'repo')}`
}

/**
 * Encodes an identifier that fills exactly one GitHub REST path segment: a
 * number (issue, pull, run, milestone, release, comment, reaction), a gist id,
 * a username, or a workflow id or file name.
 *
 * @throws When the value is empty, a dot segment, or contains a separator.
 */
export function githubPathSegment(value: string | number, paramName: string): string {
  return restoreRawSafeCharacters(safeUrlPathSegment(value, paramName))
}

/**
 * Encodes a git ref (a branch name, `heads/<branch>`, a tag, or a SHA) for a
 * path position that GitHub matches greedily, so its `/` separators are kept.
 * Each segment is escaped so a `?` or `#` cannot end the path, and a `.` or
 * `..` segment, which the URL parser would resolve away, is rejected. Git
 * forbids both in ref names, so no real ref changes.
 *
 * A numeric ref (an all-digit short SHA or branch sent as a JSON number) is
 * stringified like any other numeric segment.
 *
 * @throws When the ref is empty or contains a dot segment.
 */
export function githubRefPath(ref: string | number, paramName: string): string {
  if (typeof ref !== 'string') {
    return safeUrlPathSegment(ref, paramName)
  }
  if (ref.trim() === '') {
    throw new Error(`${paramName} is required`)
  }
  return ref
    .trim()
    .split('/')
    .map((segment) => {
      if (segment === '.' || segment === '..') {
        throw new Error(`${paramName} cannot contain "." or ".." path segments`)
      }
      try {
        return restoreRawSafeCharacters(encodeURIComponent(segment))
      } catch {
        throw new Error(`${paramName} contains an unpaired UTF-16 surrogate and cannot be encoded`)
      }
    })
    .join('/')
}
