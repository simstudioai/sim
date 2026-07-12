/**
 * Tests for OAuth utility functions
 *
 * @vitest-environment node
 */

import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oauth/oauth', () => ({
  refreshOAuthToken: vi.fn(),
  OAUTH_PROVIDERS: {},
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

const { mockDecryptSecret } = vi.hoisted(() => ({ mockDecryptSecret: vi.fn() }))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: mockDecryptSecret,
  encryptSecret: vi.fn(async (value: string) => ({ encrypted: value, iv: 'iv' })),
}))

import { db } from '@sim/db'
import { __resetCoalesceLocallyForTests } from '@/lib/concurrency/singleflight'
import { refreshOAuthToken } from '@/lib/oauth'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import {
  getCredential,
  refreshAccessTokenIfNeeded,
  refreshTokenIfNeeded,
  resolveServiceAccountToken,
} from '@/app/api/auth/oauth/utils'

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
  const mockWhere = vi.fn().mockResolvedValue({})
  const mockSet = vi.fn().mockReturnValue({ where: mockWhere })
  mockDb.update.mockReturnValueOnce({ set: mockSet })
  return { mockSet, mockWhere }
}

describe('OAuth Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCoalesceLocallyForTests()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(true)
    redisConfigMockFns.mockReleaseLock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getCredential', () => {
    it('should return credential when found', async () => {
      const mockCredentialRow = { type: 'oauth', accountId: 'resolved-account-id' }
      const mockAccountRow = { id: 'resolved-account-id', userId: 'test-user-id' }

      mockSelectChain([mockCredentialRow])
      mockSelectChain([mockAccountRow])

      const credential = await getCredential('request-id', 'credential-id', 'test-user-id')

      expect(mockDb.select).toHaveBeenCalledTimes(2)

      expect(credential).toMatchObject(mockAccountRow)
      expect(credential).toMatchObject({ resolvedCredentialId: 'resolved-account-id' })
    })

    it('should return undefined when credential is not found', async () => {
      mockSelectChain([])
      mockSelectChain([])

      const credential = await getCredential('request-id', 'nonexistent-id', 'test-user-id')

      expect(credential).toBeUndefined()
    })
  })

  describe('refreshTokenIfNeeded', () => {
    it('should return valid token without refresh if not expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      }

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'valid-token', refreshed: false })
    })

    it('should refresh token when expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: true,
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      mockUpdateChain()

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDb.update).toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'new-token', refreshed: true })
    })

    it('should handle refresh token error', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
      }

      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: false,
        errorCode: 'invalid_grant',
        message: 'Failed',
      })

      await expect(
        refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')
      ).rejects.toThrow('Failed to refresh token')
    })

    it('should not attempt refresh if no refresh token', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'token',
        refreshToken: null,
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
      }

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(result).toEqual({ accessToken: 'token', refreshed: false })
    })
  })

  describe('refreshAccessTokenIfNeeded', () => {
    it('should return valid access token without refresh if not expired', async () => {
      const mockResolvedCredential = {
        id: 'credential-id',
        type: 'oauth',
        accountId: 'account-id',
        workspaceId: 'workspace-id',
      }
      const mockAccountRow = {
        id: 'account-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockResolvedCredential])
      mockSelectChain([mockAccountRow])

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(token).toBe('valid-token')
    })

    it('should refresh token when expired', async () => {
      const mockResolvedCredential = {
        id: 'credential-id',
        type: 'oauth',
        accountId: 'account-id',
        workspaceId: 'workspace-id',
      }
      const mockAccountRow = {
        id: 'account-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockResolvedCredential])
      mockSelectChain([mockAccountRow])
      mockUpdateChain()

      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: true,
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDb.update).toHaveBeenCalled()
      expect(token).toBe('new-token')
    })

    it('should return null if credential not found', async () => {
      mockSelectChain([])
      mockSelectChain([])

      const token = await refreshAccessTokenIfNeeded('nonexistent-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
    })

    it('should return null if refresh fails', async () => {
      const mockResolvedCredential = {
        id: 'credential-id',
        type: 'oauth',
        accountId: 'account-id',
        workspaceId: 'workspace-id',
      }
      const mockAccountRow = {
        id: 'account-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockResolvedCredential])
      mockSelectChain([mockAccountRow])

      mockRefreshOAuthToken.mockResolvedValueOnce({
        ok: false,
        errorCode: 'invalid_grant',
        message: 'Failed',
      })

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
    })
  })

  describe('resolveServiceAccountToken', () => {
    it('throws loudly for an unknown provider (never silently attempts Google)', async () => {
      await expect(resolveServiceAccountToken('cred-1', 'mystery-provider')).rejects.toThrow(
        /Unsupported service-account provider/
      )
    })

    it('returns the decrypted bot token for a custom Slack bot', async () => {
      mockSelectChain([
        {
          type: 'service_account',
          providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
          encryptedServiceAccountKey: 'enc',
        },
      ])
      mockDecryptSecret.mockResolvedValueOnce({
        decrypted: JSON.stringify({ signingSecret: 's', botToken: 'xoxb-tok', teamId: 'T1' }),
      })
      const result = await resolveServiceAccountToken('cred-1', SLACK_CUSTOM_BOT_PROVIDER_ID)
      expect(result.accessToken).toBe('xoxb-tok')
    })

    it('throws when the Slack bot credential is missing', async () => {
      mockSelectChain([])
      await expect(
        resolveServiceAccountToken('cred-1', SLACK_CUSTOM_BOT_PROVIDER_ID)
      ).rejects.toThrow(/Slack bot credential not found/)
    })

    it('returns apiToken + cloudId + domain for Atlassian', async () => {
      mockSelectChain([{ encryptedServiceAccountKey: 'enc' }])
      mockDecryptSecret.mockResolvedValueOnce({
        decrypted: JSON.stringify({
          type: 'atlassian_service_account',
          apiToken: 'atk',
          domain: 'acme.atlassian.net',
          cloudId: 'cloud-1',
        }),
      })
      const result = await resolveServiceAccountToken(
        'cred-1',
        ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
      )
      expect(result).toMatchObject({
        accessToken: 'atk',
        cloudId: 'cloud-1',
        domain: 'acme.atlassian.net',
      })
    })

    it('requires scopes for a Google service account', async () => {
      await expect(
        resolveServiceAccountToken('cred-1', GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID, [])
      ).rejects.toThrow(/Scopes are required/)
    })
  })
})
