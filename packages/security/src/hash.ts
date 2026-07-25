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
