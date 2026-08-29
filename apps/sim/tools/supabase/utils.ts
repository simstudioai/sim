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
 * as a separator while encoding each segment.
 *
 * This previously read as sanitisation while providing none against traversal:
 * it split on `/` and ran `encodeURIComponent` over each piece, but `.` and
 * `..` are unreserved, so `encodeURIComponent('..') === '..'` and a key of
 * `../..` came out byte-for-byte unchanged. The URL parser then removed those
 * dot segments *after* decoding, walking the request — with the workspace's
 * Supabase service-role key attached — out of `/storage/v1/object/`. Only
 * rejecting a dot segment closes that, which is what `safeUrlPath` does.
 *
 * ## Why the whole value is trimmed, but its segments are not
 *
 * `safeUrlPath` deliberately trims nowhere, because a leading or trailing space
 * is a legal filename character and rewriting it addresses a different object.
 * Applied naively to a storage key that broke a real flow: the old helper
 * trimmed, so a saved workflow whose key field carried a pasted stray space
 * resolved fine, and preserving the padding turned it into a 404.
 *
 * ```
 * old: "  avatars/photo.png  "  ->  avatars/photo.png              (found it)
 * new: "  avatars/photo.png  "  ->  %20%20avatars/photo.png%20%20  (404)
 * ```
 *
 * So the *whole value* is trimmed — restoring the behaviour that pasted keys
 * relied on — while whitespace **inside** the key is preserved, keeping the
 * correctness `safeUrlPath` exists to provide. The two cases are different in
 * kind: edge padding on the whole value is a paste artifact and never part of
 * the key, whereas `avatars/ photo.png` names a component that genuinely starts
 * with a space.
 *
 * ## Why no variant refuses instead of trimming
 *
 * Elsewhere this branch refuses a padded identifier rather than trimming it,
 * because trimming turns a request that used to 404 into one that mutates a
 * real resource — see `strictUrlPathSegment`. That rule applies to
 * **state-changing** requests where being wrong is unrecoverable, and **no such
 * request reaches this helper**. The keys of the destructive storage
 * operations never pass through it:
 *
 * - `storage_delete` sends its keys in the request **body** (`prefixes`); only
 *   the bucket reaches a path guard.
 * - `storage_move` and `storage_copy` likewise use the body (`sourceKey`,
 *   `destinationKey`).
 *
 * Its actual callers are `storage_download`, `storage_get_public_url` and
 * `storage_create_signed_url` (reads), plus `storage_upload` and
 * `storage_create_signed_upload_url`. Upload and download therefore trim
 * identically, so a padded key is never *stored* padded and the pair cannot
 * disagree about what a key is — which was the original reason for preserving,
 * satisfied here without breaking pasted keys.
 *
 * `path_safety.test.ts` pins that no destructive operation routes a key here,
 * because this reasoning depends on it and it could change silently.
 */
export function encodeStoragePath(path: string, paramName = 'path'): string {
  return safeUrlPath(path.trim(), paramName)
}
