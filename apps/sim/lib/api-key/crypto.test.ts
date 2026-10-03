/**
 * Tests for the API-key crypto primitives.
 *
 * `hashApiKey` is the foundation of both the new hash-first authentication
 * path and the `backfill-api-key-hash` script — the backfill is idempotent
 * precisely because `hashApiKey` is deterministic and the encrypted round-trip
 * recovers the same plain-text key on every run.
 */
import { randomBytes } from 'crypto'
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateSecureToken } = vi.hoisted(() => ({ mockGenerateSecureToken: vi.fn() }))
vi.mock('@sim/security/tokens', () => ({ generateSecureToken: mockGenerateSecureToken }))

beforeAll(() => {
  setEnv({ API_ENCRYPTION_KEY: undefined })
})

afterAll(resetEnvMock)

import { decryptApiKey, encryptApiKey, generateApiKey, hashApiKey } from '@/lib/api-key/crypto'

const FIXED_ENCRYPTION_KEY = '0'.repeat(64)

describe('hashApiKey', () => {
  it('matches the published SHA-256 vector for the empty string', () => {
    expect(hashApiKey('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('backfill idempotency — encrypted round-trip', () => {
  beforeEach(() => {
    setEnv({ API_ENCRYPTION_KEY: FIXED_ENCRYPTION_KEY })
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
})

describe('generateApiKey', () => {
  it('never issues a legacy key that reads as an OAuth access token', () => {
    mockGenerateSecureToken.mockReturnValueOnce('oat_collision').mockReturnValueOnce('plain_token')
    expect(generateApiKey()).toBe('sim_plain_token')
    expect(mockGenerateSecureToken).toHaveBeenCalledTimes(2)
  })
})
