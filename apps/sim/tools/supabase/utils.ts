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
 * Builds a storage object path for use inside a URL, preserving `/` as a path
 * separator while encoding each segment (and trimming copy-paste whitespace)
 * so spaces, `#`, `?`, and other reserved characters in file names don't
 * corrupt the request.
 *
 * Delegates to `safeUrlPath`: encoding each segment *reads* as sanitization
 * but maps `'../..'` straight through, because `encodeURIComponent('..')` is
 * `'..'`. Dot segments, empty segments, and backslashes are therefore
 * rejected. Storage paths are genuinely multi-segment, so the single-segment
 * helper is not usable here.
 */
export function encodeStoragePath(path: string, paramName = 'path'): string {
  return safeUrlPath(path, paramName)
}
