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
