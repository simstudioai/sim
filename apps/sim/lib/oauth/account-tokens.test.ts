/**
 * @vitest-environment node
 */
import { resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsFeatureEnabled } = vi.hoisted(() => ({ mockIsFeatureEnabled: vi.fn() }))

vi.mock('@/lib/core/config/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

import { encryptAccountToken } from '@/lib/oauth/account-token-crypto'
import {
  decryptAccountTokenColumns,
  decryptAccountTokenColumnsBatch,
  encryptAccountTokenColumns,
} from '@/lib/oauth/account-tokens'

const VALID_KEY = '0123456789abcdef'.repeat(4)

/** Stands in for the scrypt hash Better Auth writes; only its presence matters here. */
const passwordHashPlaceholder = 'hash'

/** The shape `docker-compose.local.yml` ships: long enough for env validation, not hex. */
const SELF_HOSTED_BAD_KEY = 'z'.repeat(36)

beforeEach(() => {
  vi.clearAllMocks()
  resetEnvMock()
  setEnv({ ENCRYPTION_KEY: VALID_KEY })
  mockIsFeatureEnabled.mockResolvedValue(true)
})

afterAll(resetEnvMock)

describe('the write gate', () => {
  it('envelopes when the flag is on and the key is usable', async () => {
    const { accessToken } = await encryptAccountTokenColumns({ accessToken: 'access' })
    expect(accessToken?.startsWith('simenc:v1:')).toBe(true)
  })

  it('writes plaintext when the flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    await expect(encryptAccountTokenColumns({ accessToken: 'access' })).resolves.toEqual({
      accessToken: 'access',
    })
  })

  /**
   * A deployment can boot with a key this codebase rejects on first use, and losing the
   * user's connect is worse than storing plaintext — so the gate degrades, never throws.
   */
  it.each([
    ['the self-hosted placeholder key', SELF_HOSTED_BAD_KEY],
    ['a 64-char non-hex key', 'z'.repeat(64)],
    ['a short key', 'abcdef'],
    ['an unset key', undefined],
  ])('writes plaintext with %s even when the flag is on', async (_label, key) => {
    setEnv({ ENCRYPTION_KEY: key })
    await expect(encryptAccountTokenColumns({ accessToken: 'access' })).resolves.toEqual({
      accessToken: 'access',
    })
  })

  /** Passing a context would make the flag able to hit the database on every token write. */
  it('resolves the flag with no context object', async () => {
    await encryptAccountTokenColumns({ accessToken: 'access' })
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('oauth-token-encryption')
  })

  it('never consults the flag on the read path', async () => {
    await decryptAccountTokenColumns({ accessToken: 'token.placeholder-value' })
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled()
  })
})

describe('encryptAccountTokenColumns', () => {
  it('envelopes all three token fields', async () => {
    const result = await encryptAccountTokenColumns({
      accessToken: 'access',
      refreshToken: 'refresh',
      idToken: 'id',
    })

    for (const value of Object.values(result)) {
      expect(value?.startsWith('simenc:v1:')).toBe(true)
    }
  })

  /**
   * Better Auth's `update.before` also fires for password changes: `updatePassword`
   * routes through `updateManyWithHooks` with a `{ password }`-only payload.
   */
  it('leaves a password-only update payload completely untouched', async () => {
    const payload = { password: passwordHashPlaceholder }
    await expect(encryptAccountTokenColumns(payload)).resolves.toEqual(payload)
  })

  it('preserves non-token keys alongside the tokens', async () => {
    const result = await encryptAccountTokenColumns({
      accessToken: 'access',
      scope: 'read write',
      providerId: 'google-drive',
    })

    expect(result.scope).toBe('read write')
    expect(result.providerId).toBe('google-drive')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string (SAML rows)', ''],
  ])('passes a %s token through unchanged', async (_label, value) => {
    const result = await encryptAccountTokenColumns({ accessToken: value })
    expect(result.accessToken).toBe(value)
  })

  it('does not introduce a key that was absent from the payload', async () => {
    const result = await encryptAccountTokenColumns({ accessToken: 'access' })
    expect('refreshToken' in result).toBe(false)
    expect('idToken' in result).toBe(false)
  })

  it('is idempotent, so Better Auth write-backs never double-wrap', async () => {
    const once = await encryptAccountTokenColumns({ accessToken: 'access' })
    const twice = await encryptAccountTokenColumns(once)
    expect(twice.accessToken).toBe(once.accessToken)
  })

  it('does not mutate the input object', async () => {
    const input = { accessToken: 'access' }
    await encryptAccountTokenColumns(input)
    expect(input.accessToken).toBe('access')
  })
})

describe('decryptAccountTokenColumns', () => {
  it('recovers enveloped tokens', async () => {
    const encrypted = await encryptAccountTokenColumns({
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    const result = await decryptAccountTokenColumns(encrypted)

    expect(result.accessToken).toBe('access')
    expect(result.refreshToken).toBe('refresh')
  })

  /** The mixed-format guarantee that makes the rollout and the backfill safe. */
  it('returns legacy plaintext unchanged, regardless of the flag', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const result = await decryptAccountTokenColumns({
      accessToken: 'token.placeholder-value',
      refreshToken: null,
    })

    expect(result.accessToken).toBe('token.placeholder-value')
  })

  it('reads a row that is half migrated', async () => {
    const result = await decryptAccountTokenColumns({
      accessToken: await encryptAccountToken('fresh'),
      refreshToken: 'legacy-plaintext',
    })

    expect(result.accessToken).toBe('fresh')
    expect(result.refreshToken).toBe('legacy-plaintext')
  })

  it('nulls an unrecoverable field and never throws', async () => {
    const encrypted = await encryptAccountToken('refresh')
    setEnv({ ENCRYPTION_KEY: 'f'.repeat(64) })

    const result = await decryptAccountTokenColumns({
      accessToken: 'plaintext-still-fine',
      refreshToken: encrypted,
    })

    expect(result.refreshToken).toBeNull()
    expect(result.accessToken).toBe('plaintext-still-fine')
  })

  it('does not mutate the input row', async () => {
    const encrypted = await encryptAccountToken('access')
    const input = { accessToken: encrypted }
    await decryptAccountTokenColumns(input)
    expect(input.accessToken).toBe(encrypted)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('passes a %s token through unchanged', async (_label, value) => {
    const result = await decryptAccountTokenColumns({ accessToken: value })
    expect(result.accessToken).toBe(value)
  })
})

describe('decryptAccountTokenColumnsBatch', () => {
  it('decrypts every row and isolates a poisoned one', async () => {
    const good = await encryptAccountTokenColumns({ accessToken: 'good' })
    const poisoned = { accessToken: 'simenc:v1:deadbeef' }

    const [first, second, third] = await decryptAccountTokenColumnsBatch([
      good,
      poisoned,
      { accessToken: 'legacy' },
    ])

    expect(first.accessToken).toBe('good')
    expect(second.accessToken).toBeNull()
    expect(third.accessToken).toBe('legacy')
  })
})
