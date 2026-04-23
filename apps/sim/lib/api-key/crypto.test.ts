/**
 * Tests for the API-key crypto primitives.
 *
 * `hashApiKey` is the foundation of both the new hash-first authentication
 * path and the `backfill-api-key-hash` script — the backfill is idempotent
 * precisely because `hashApiKey` is deterministic and the encrypted round-trip
 * recovers the same plain-text key on every run.
 *
 * @vitest-environment node
 */
import { randomBytes } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { API_ENCRYPTION_KEY: undefined as string | undefined },
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
}))

import {
  decryptApiKey,
  encryptApiKey,
  hashApiKey,
  isEncryptedApiKeyFormat,
  isLegacyApiKeyFormat,
} from '@/lib/api-key/crypto'

const FIXED_ENCRYPTION_KEY = '0'.repeat(64)

describe('hashApiKey', () => {
  it('is deterministic — same input produces same hash', () => {
    const h1 = hashApiKey('sk-sim-example')
    const h2 = hashApiKey('sk-sim-example')
    expect(h1).toBe(h2)
  })

  it('produces a 64-char hex SHA-256 digest', () => {
    const hash = hashApiKey('sk-sim-example')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('sk-sim-a')).not.toBe(hashApiKey('sk-sim-b'))
  })

  it('matches the published SHA-256 vector for the empty string', () => {
    expect(hashApiKey('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('backfill idempotency — encrypted round-trip', () => {
  beforeEach(() => {
    mockEnv.API_ENCRYPTION_KEY = FIXED_ENCRYPTION_KEY
  })

  it('re-running the backfill on the same row yields the same keyHash', async () => {
    const plainKey = `sk-sim-${randomBytes(12).toString('hex')}`
    const { encrypted } = await encryptApiKey(plainKey)

    const { decrypted: first } = await decryptApiKey(encrypted)
    const { decrypted: second } = await decryptApiKey(encrypted)

    expect(first).toBe(plainKey)
    expect(second).toBe(plainKey)
    expect(hashApiKey(first)).toBe(hashApiKey(second))
  })

  it('is stable whether the stored key is legacy plain text or encrypted', async () => {
    const plainKey = 'sim_legacy-format-key'
    const { encrypted } = await encryptApiKey(plainKey)

    const { decrypted } = await decryptApiKey(encrypted)
    expect(hashApiKey(decrypted)).toBe(hashApiKey(plainKey))
  })
})

describe('api-key format helpers', () => {
  it('treats sk-sim- prefix as the encrypted format', () => {
    expect(isEncryptedApiKeyFormat('sk-sim-abc')).toBe(true)
    expect(isLegacyApiKeyFormat('sk-sim-abc')).toBe(false)
  })

  it('treats sim_ prefix as the legacy format', () => {
    expect(isLegacyApiKeyFormat('sim_abc')).toBe(true)
    expect(isEncryptedApiKeyFormat('sim_abc')).toBe(false)
  })
})
