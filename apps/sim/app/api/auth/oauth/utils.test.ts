/**
 * Tests for OAuth utility functions
 */

import { redisConfigMockFns } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/oauth', () => ({
  refreshOAuthToken: vi.fn(),
  OAUTH_PROVIDERS: {},
  TOKEN_REFRESH_TIMEOUT_MS: 15_000,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

const { mockMinter } = vi.hoisted(() => ({ mockMinter: vi.fn() }))
vi.mock('@/lib/credentials/client-credential-accounts/server', () => ({
  getClientCredentialAccountMinter: vi.fn(() => mockMinter),
  parseClientCredentialAccountSecretBlob: vi.fn((decrypted: string) => JSON.parse(decrypted)),
}))

import { db } from '@sim/db'
import { __resetCoalesceLocallyForTests } from '@/lib/concurrency/singleflight'
import { ZOOM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/client-credential-accounts/descriptors'
import { refreshOAuthToken } from '@/lib/oauth'
import { refreshTokenIfNeeded, resolveServiceAccountToken } from '@/lib/oauth/credential-service'
import { getOAuthRefreshCoordinationIdentity } from '@/lib/oauth/refresh-coordination'
import { GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const mockDecryptSecret = encryptionMockFns.mockDecryptSecret
encryptionMockFns.mockEncryptSecret.mockImplementation(async (value: string) => ({
  encrypted: value,
  iv: 'iv',
}))

const mockDb = db as any
const mockRefreshOAuthToken = refreshOAuthToken as any

/**
 * Creates a chainable mock for db.select() calls.
 * Returns a nested chain: select() -> from() -> where() -> limit() / orderBy()
 */
function mockSelectChain(limitResult: unknown[]) {
  const mockLimit = vi.fn().mockReturnValue(limitResult)
  const mockOrderBy = vi.fn().mockReturnValue(limitResult)
  const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  mockDb.select.mockReturnValueOnce({ from: mockFrom })
  return { mockFrom, mockWhere, mockLimit }
}

/**
 * Creates a chainable mock for db.update() calls.
 * Returns a nested chain: update() -> set() -> where()
 */
function mockUpdateChain() {
  /** The rotated write returns the row it matched; an empty result means the chain moved first. */
  const mockReturning = vi.fn().mockResolvedValue([{ id: 'account-1' }])
  const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning })
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  mockDb.update.mockReturnValueOnce({ set: mockSet })
  return { mockSet, mockWhere }
}

describe('OAuth Utils', () => {
  beforeEach(() => {
    __resetCoalesceLocallyForTests()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
  })

  describe('Slack installation-scoped refresh', () => {
    const SLACK_ACCOUNT_ID = 'T08CM6ZNYBE-usr_U08USBQ9B1T-cbf46a7e-ca75-4a2e-bef5-fd467299eaae'
    const past = new Date(Date.now() - 3600 * 1000)
    const future = new Date(Date.now() + 3600 * 1000)

    /** Select chain for getFreshestSlackChain: where() -> orderBy() -> limit(). */
    function mockSelectOrderedChain(limitResult: unknown[]) {
      const mockLimit = vi.fn().mockReturnValue(limitResult)
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit })
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
      mockDb.select.mockReturnValueOnce({ from: mockFrom })
      return { mockWhere, mockOrderBy, mockLimit }
    }

    function slackCredential(overrides: Record<string, unknown> = {}) {
      return {
        id: 'row-1',
        resolvedCredentialId: 'row-1',
        accountId: SLACK_ACCOUNT_ID,
        accessToken: 'stale-at',
        refreshToken: 'stale-rt',
        accessTokenExpiresAt: past,
        providerId: 'slack',
        ...overrides,
      }
    }

    it('locks per installation and refreshes with the freshest sibling refresh token', async () => {
      mockSelectOrderedChain([
        { accessToken: 'stale-at', refreshToken: 'live-rt', accessTokenExpiresAt: past },
      ])
      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: true,
        accessToken: 'new-at',
        expiresIn: 43200,
        refreshToken: 'new-rt',
      })
      const { mockSet } = mockUpdateChain()

      const result = await refreshTokenIfNeeded('request-id', slackCredential(), 'row-1')

      expect(result).toEqual({ accessToken: 'new-at', refreshed: true })
      const installationIdentity = getOAuthRefreshCoordinationIdentity('slack:T08CM6ZNYBE')
      expect(redisConfigMockFns.mockAcquireLock.mock.calls[0][0]).toBe(
        `oauth:refresh:${installationIdentity}`
      )
      expect(installationIdentity).not.toContain('T08CM6ZNYBE')
      expect(redisConfigMockFns.mockAcquireLock.mock.calls[0][2]).toBe(30)
      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('slack', 'live-rt')
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'new-at', refreshToken: 'new-rt' })
      )
    })

    it('returns the freshest sibling token without refreshing when it is still valid', async () => {
      mockSelectOrderedChain([
        { accessToken: 'sibling-at', refreshToken: 'live-rt', accessTokenExpiresAt: future },
      ])
      const { mockSet } = mockUpdateChain()

      const result = await refreshTokenIfNeeded('request-id', slackCredential(), 'row-1')

      expect(result).toEqual({ accessToken: 'sibling-at', refreshed: true })
      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'sibling-at', refreshToken: 'live-rt' })
      )
    })

    it('dead-flags the installation, not the row, on terminal refresh errors', async () => {
      const fakeRedis = {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn().mockResolvedValue(1),
      }
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(fakeRedis)
      mockSelectOrderedChain([
        { accessToken: 'stale-at', refreshToken: 'live-rt', accessTokenExpiresAt: past },
      ])
      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: false,
        errorCode: 'token_revoked',
      })
      mockSelectChain([])

      await expect(refreshTokenIfNeeded('request-id', slackCredential(), 'row-1')).rejects.toThrow(
        'Failed to refresh token'
      )

      const installationIdentity = getOAuthRefreshCoordinationIdentity('slack:T08CM6ZNYBE')
      expect(fakeRedis.set).toHaveBeenCalledWith(
        `oauth:dead:${installationIdentity}`,
        'token_revoked',
        'EX',
        3600
      )
    })

    it('skips the dead flag when the chain moved during the failed refresh', async () => {
      const fakeRedis = {
        set: vi.fn().mockResolvedValue('OK'),
        get: vi.fn().mockResolvedValue(null),
        del: vi.fn().mockResolvedValue(1),
      }
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(fakeRedis)
      mockSelectOrderedChain([
        { accessToken: 'stale-at', refreshToken: 'live-rt', accessTokenExpiresAt: past },
      ])
      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: false,
        errorCode: 'token_revoked',
      })
      mockSelectChain([{ moved: new Date() }])

      await expect(refreshTokenIfNeeded('request-id', slackCredential(), 'row-1')).rejects.toThrow(
        'Failed to refresh token'
      )

      expect(fakeRedis.set).not.toHaveBeenCalled()
    })
  })

  describe('resolveServiceAccountToken', () => {
    it('throws loudly for an unknown provider (never silently attempts Google)', async () => {
      await expect(resolveServiceAccountToken('cred-1', 'mystery-provider')).rejects.toThrow(
        /Unsupported service-account provider/
      )
    })

    it('requires scopes for a Google service account', async () => {
      await expect(
        resolveServiceAccountToken('cred-1', GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID, [])
      ).rejects.toThrow(/Scopes are required/)
    })
  })

  describe('resolveServiceAccountToken — client-credential mint cache', () => {
    const ENCRYPTED_KEY_A = `${'a'.repeat(32)}rest-of-ciphertext`
    const ENCRYPTED_KEY_B = `${'b'.repeat(32)}rest-of-ciphertext`
    const BLOB_FIELDS = { clientId: 'cid', clientSecret: 'cs', orgId: 'org' }

    let now: number
    let dateNowSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      now = 1_750_000_000_000
      dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
      mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(BLOB_FIELDS) })
    })

    afterEach(() => {
      dateNowSpy.mockRestore()
    })

    function mockCredentialRow(encryptedServiceAccountKey: string) {
      mockSelectChain([{ encryptedServiceAccountKey }])
    }

    it('mints once with skipIdentity, then serves cache hits preserving instanceUrl', async () => {
      const credId = 'ccsa-cache-hit'
      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockResolvedValueOnce({
        accessToken: 'tok-1',
        expiresInSeconds: 3600,
        instanceUrl: 'https://org.my.salesforce.com',
      })

      const first = await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      expect(first).toEqual({
        accessToken: 'tok-1',
        instanceUrl: 'https://org.my.salesforce.com',
      })
      expect(mockMinter).toHaveBeenCalledWith(BLOB_FIELDS, { skipIdentity: true })

      mockCredentialRow(ENCRYPTED_KEY_A)
      const second = await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      expect(second).toEqual({
        accessToken: 'tok-1',
        instanceUrl: 'https://org.my.salesforce.com',
      })
      expect(mockMinter).toHaveBeenCalledTimes(1)
    })

    it('re-mints when remaining validity is below the 5-minute serve floor', async () => {
      const credId = 'ccsa-ttl-floor'
      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockResolvedValueOnce({ accessToken: 'tok-1', expiresInSeconds: 240 })

      await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockResolvedValueOnce({ accessToken: 'tok-2', expiresInSeconds: 3600 })
      const second = await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      expect(second.accessToken).toBe('tok-2')
      expect(mockMinter).toHaveBeenCalledTimes(2)
    })

    it('re-mints when the stored secret fingerprint changes (credential rotation)', async () => {
      const credId = 'ccsa-rotation'
      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockResolvedValueOnce({ accessToken: 'old-app-token', expiresInSeconds: 3600 })

      await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      mockCredentialRow(ENCRYPTED_KEY_B)
      mockMinter.mockResolvedValueOnce({ accessToken: 'new-app-token', expiresInSeconds: 3600 })
      const second = await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      expect(second.accessToken).toBe('new-app-token')
      expect(mockMinter).toHaveBeenCalledTimes(2)
    })

    it('never caches a failed mint as a token but memoizes the failure for ~30s', async () => {
      const credId = 'ccsa-negative-memo'
      const mintError = new Error('invalid_credentials')
      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockRejectedValueOnce(mintError)

      await expect(
        resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)
      ).rejects.toBe(mintError)

      mockCredentialRow(ENCRYPTED_KEY_A)
      await expect(
        resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)
      ).rejects.toBe(mintError)
      expect(mockMinter).toHaveBeenCalledTimes(1)

      now += 31_000
      mockCredentialRow(ENCRYPTED_KEY_A)
      mockMinter.mockResolvedValueOnce({ accessToken: 'tok-after', expiresInSeconds: 3600 })
      const result = await resolveServiceAccountToken(credId, ZOOM_SERVICE_ACCOUNT_PROVIDER_ID)

      expect(result.accessToken).toBe('tok-after')
      expect(mockMinter).toHaveBeenCalledTimes(2)
    })
  })
})
