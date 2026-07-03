import { validateSupabaseProjectId } from '@/lib/core/security/input-validation'

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
 * URL-encodes a single storage path segment (bucket name), trimming
 * copy-paste whitespace first so the value is safe to interpolate into a URL.
 */
export function encodeStorageSegment(segment: string): string {
  return encodeURIComponent(segment.trim())
}

/**
 * URL-encodes a storage object path for use inside a URL, preserving `/`
 * as a path separator while encoding each segment (and trimming
 * copy-paste whitespace) so spaces, `#`, `?`, and other reserved
 * characters in file names don't corrupt the request.
 */
export function encodeStoragePath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment.trim()))
    .join('/')
}
