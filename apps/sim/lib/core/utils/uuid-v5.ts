import { createHash } from 'node:crypto'

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

/**
 * Deterministic UUIDv5 (SHA-1) of `name` within `namespace`, per RFC 4122 §4.3.
 * The same inputs always yield the same UUID, which is how callers derive a
 * stable identity from a caller-chosen string.
 *
 * SHA-1 is mandated by RFC 4122 for UUIDv5 and is used here only for
 * deterministic id derivation, never for secrecy or integrity. Every caller
 * pins its own namespace constant; changing a namespace re-keys every id that
 * caller ever derived.
 */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
  hash.update(uuidToBytes(namespace)) // lgtm[js/weak-cryptographic-algorithm]
  hash.update(Buffer.from(name, 'utf8')) // lgtm[js/weak-cryptographic-algorithm]
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
