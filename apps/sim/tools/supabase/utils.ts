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
 * Builds a traversal-safe single URL path segment for a storage bucket name.
 *
 * A bucket name is flat, so any `/` in it means the caller passed an object key
 * where a bucket was expected; `safeUrlPathSegment` refuses it by name rather
 * than silently addressing a different bucket.
 */
export function encodeStorageSegment(segment: string, paramName = 'bucket'): string {
  return safeUrlPathSegment(segment, paramName)
}

/**
 * Builds a traversal-safe URL path from a storage object key, preserving `/`
 * as a separator while encoding each segment, so spaces, `#`, `?`, and other
 * reserved characters in file names don't corrupt the request.
 *
 * This previously read as sanitisation while providing none against traversal:
 * it split on `/` and ran `encodeURIComponent` over each piece, but `.` and
 * `..` are unreserved, so `encodeURIComponent('..') === '..'` and a key of
 * `../..` came out byte-for-byte unchanged. The URL parser then removed those
 * dot segments *after* decoding, walking the request — with the workspace's
 * Supabase service-role key attached — out of `/storage/v1/object/` and into
 * any other API prefix on the same host, including on DELETE. Only rejecting a
 * dot segment closes that, which is what `safeUrlPath` does.
 *
 * `safeUrlPath` also rejects an empty segment, which is a deliberate tightening
 * rather than an accident of reuse. A leading or doubled separator addresses a
 * *different* object than the caller wrote — `avatars//folder/x.png` and
 * `avatars/folder/x.png` are distinct paths, and the old helper emitted the
 * former silently. No real key needs one: `executeStorageUploadOperation`
 * normalizes its own trailing separator before joining `path` and `fileName`,
 * so the only way to produce an empty segment is a typo the caller wants to
 * hear about.
 */
export function encodeStoragePath(path: string, paramName = 'path'): string {
  return safeUrlPath(path, paramName)
}
