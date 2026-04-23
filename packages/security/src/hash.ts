import { createHash } from 'node:crypto'

/**
 * Deterministic SHA-256 digest of a UTF-8 string, hex-encoded. Use for
 * indexed lookup of sensitive values (e.g. API key hash columns) where the
 * caller only needs to verify equality without ever reversing the hash.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}
