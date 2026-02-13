/**
 * Tests for OAuth utility functions
 *
 * @vitest-environment node
 */

import { databaseMock, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)

vi.mock('@/lib/oauth/oauth', () => ({
  refreshOAuthToken: vi.fn(),
  OAUTH_PROVIDERS: {},
}))

vi.mock('@sim/logger', () => loggerMock)

import { db } from '@sim/db'
import { refreshOAuthToken } from '@/lib/oauth'
import {
  getCredential,
  refreshAccessTokenIfNeeded,
  refreshTokenIfNeeded,
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getCredential', () => {
    it('should return credential when found', async () => {
      const mockCredential = { id: 'credential-id', userId: 'test-user-id' }
      const { mockFrom, mockWhere, mockLimit } = mockSelectChain([mockCredential])

      const credential = await getCredential('request-id', 'credential-id', 'test-user-id')

      expect(mockDb.select).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
      expect(mockLimit).toHaveBeenCalledWith(1)

      expect(credential).toEqual(mockCredential)
    })

    it('should return undefined when credential is not found', async () => {
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

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

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
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockCredential])

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).not.toHaveBeenCalled()
      expect(token).toBe('valid-token')
    })

    it('should refresh token when expired', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockCredential])
      mockUpdateChain()

      mockRefreshOAuthToken.mockResolvedValueOnce({
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

      const token = await refreshAccessTokenIfNeeded('nonexistent-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
    })

    it('should return null if refresh fails', async () => {
      const mockCredential = {
        id: 'credential-id',
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000),
        providerId: 'google',
        userId: 'test-user-id',
      }
      mockSelectChain([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
    })
  })
})
