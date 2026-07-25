import { createHash } from 'node:crypto'

/**
 * Deterministic SHA-256 digest, hex-encoded. Strings hash as UTF-8; binary
 * content passes as a Uint8Array/Buffer. Use for indexed lookup of sensitive
 * values (e.g. API key hash columns) and content-integrity receipts where the
 * caller only needs to verify equality without ever reversing the hash.
 */
export function sha256Hex(input: string | Uint8Array): string {
  const hash = createHash('sha256')
  if (typeof input === 'string') {
    hash.update(input, 'utf8')
  } else {
    hash.update(input)
  }
  return hash.digest('hex')
}

/**
 * SHA-256 digest, base64url-encoded. The encoding PKCE specifies for a code
 * challenge (RFC 7636), so both sides of a challenge/verifier exchange can
 * derive it from one implementation instead of two that must stay in step.
 */
export function sha256Base64Url(input: string | Uint8Array): string {
  const hash = createHash('sha256')
  if (typeof input === 'string') {
    hash.update(input, 'utf8')
  } else {
    hash.update(input)
  }
  return hash.digest('base64url')
}
