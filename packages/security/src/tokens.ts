import { randomBytes } from 'node:crypto'

/**
 * Generate a cryptographically secure random token encoded as base64url. The
 * returned string is URL-safe (no padding, no `+`/`/`) and suitable for use
 * as an API key body, bearer token, or one-time identifier.
 *
 * @param byteLength - Number of random bytes to draw before encoding. Defaults to 24 (~32 chars).
 */
export function generateSecureToken(byteLength = 24): string {
  return randomBytes(byteLength).toString('base64url')
}
