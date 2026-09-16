/**
 * The headers that carry external API credentials, and the header-only check
 * for them. Deliberately dependency-free: the route wrapper classifies every
 * request with this before any authentication happens, and it must not pull
 * the authentication graph in to do so.
 */

export const API_KEY_HEADER = 'x-api-key'
export const BEARER_PREFIX = 'Bearer '

/**
 * Whether a request carries external API credentials — an API key or a bearer
 * token. Inspects headers only and validates nothing: it classifies the
 * request as programmatic API traffic rather than interactive session traffic.
 */
export function hasExternalApiCredentials(headers: { get(name: string): string | null }): boolean {
  if (headers.get(API_KEY_HEADER) !== null) return true
  const auth = headers.get('authorization')
  return auth?.startsWith(BEARER_PREFIX) ?? false
}
