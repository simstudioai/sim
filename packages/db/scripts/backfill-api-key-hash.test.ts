/**
 * @vitest-environment node
 *
 * Tests for the pure helpers used by `backfill-api-key-hash.ts`. The script
 * itself does I/O against Postgres and is not tested here; idempotency is a
 * property of the helpers — running them twice on the same input produces the
 * same output, so re-running the script after an interruption recomputes the
 * same hash for every row.
 */
import { createCipheriv } from 'crypto'
import { describe, expect, it } from 'vitest'
import { deriveKeyHashForStoredKey, hashApiKey, isEncryptedKey } from './backfill-api-key-hash'

const FIXED_ENCRYPTION_KEY = '0'.repeat(64)

function encryptForTest(plainKey: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = Buffer.from('11'.repeat(16), 'hex')
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  let encrypted = cipher.update(plainKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

describe('hashApiKey', () => {
  it('is deterministic', () => {
    expect(hashApiKey('sim_abc')).toBe(hashApiKey('sim_abc'))
  })

  it('returns a 64-char hex digest', () => {
    expect(hashApiKey('sim_abc')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isEncryptedKey', () => {
  it('detects "iv:encrypted:authTag" format', () => {
    expect(isEncryptedKey('aa:bb:cc')).toBe(true)
  })

  it('rejects plain text', () => {
    expect(isEncryptedKey('sim_plain')).toBe(false)
  })

  it('rejects strings with the wrong number of colons', () => {
    expect(isEncryptedKey('a:b')).toBe(false)
    expect(isEncryptedKey('a:b:c:d')).toBe(false)
  })
})

describe('deriveKeyHashForStoredKey — backfill idempotency', () => {
  it('hashes a legacy plain-text row', () => {
    const hash = deriveKeyHashForStoredKey('sim_legacy-plain', null)
    expect(hash).toBe(hashApiKey('sim_legacy-plain'))
  })

  it('decrypts + hashes an encrypted row, matching the plaintext hash', () => {
    const plainKey = 'sk-sim-some-example-key'
    const encrypted = encryptForTest(plainKey, FIXED_ENCRYPTION_KEY)

    const hash = deriveKeyHashForStoredKey(encrypted, FIXED_ENCRYPTION_KEY)
    expect(hash).toBe(hashApiKey(plainKey))
  })

  it('produces the same hash when re-run on the same row', () => {
    const plainKey = 'sk-sim-idempotent'
    const encrypted = encryptForTest(plainKey, FIXED_ENCRYPTION_KEY)

    const first = deriveKeyHashForStoredKey(encrypted, FIXED_ENCRYPTION_KEY)
    const second = deriveKeyHashForStoredKey(encrypted, FIXED_ENCRYPTION_KEY)
    expect(first).toBe(second)
  })

  it('throws when the row looks encrypted but no encryption key is supplied', () => {
    const encrypted = encryptForTest('sk-sim-x', FIXED_ENCRYPTION_KEY)
    expect(() => deriveKeyHashForStoredKey(encrypted, null)).toThrow(/API_ENCRYPTION_KEY/)
  })
})
