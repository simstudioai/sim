import { generateRandomBytes } from '@sim/utils/random'

/**
 * Generate a cryptographically secure random token encoded as base64url. The
 * returned string is URL-safe (no padding, no `+`/`/`) and suitable for use
 * as an API key body, bearer token, or one-time identifier.
 *
 * @param byteLength - Number of random bytes to draw before encoding. Defaults to 24 (~32 chars).
 */
export function generateSecureToken(byteLength = 24): string {
  return Buffer.from(generateRandomBytes(byteLength)).toString('base64url')
}
