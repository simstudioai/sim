/** Base URL for all RB2B API v1 endpoints. */
export const RB2B_API_BASE = 'https://api.rb2b.com/api/v1'

/** Standard headers for RB2B requests. Auth is an `Api-Key` header. */
export function rb2bHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Api-Key': apiKey,
  }
}

/**
 * HEM endpoints accept either a plaintext email or an MD5 hash under the
 * `email` / `md5` body key respectively. Route the value to the correct key.
 */
export function buildIdentifierBody(value: string): Record<string, string> {
  return value.includes('@') ? { email: value } : { md5: value }
}
