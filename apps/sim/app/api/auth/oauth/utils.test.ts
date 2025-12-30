/**
 * Tests for OAuth utility functions
 *
 * @vitest-environment node
 */

import { createSession, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSession = createSession({ userId: 'test-user-id' })
const mockGetSession = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
  },
}))

vi.mock('@/lib/oauth/oauth', () => ({
  refreshOAuthToken: vi.fn(),
  OAUTH_PROVIDERS: {},
}))

vi.mock('@sim/logger', () => loggerMock)

import { db } from '@sim/db'
import { refreshOAuthToken } from '@/lib/oauth'
import {
  getCredential,
  getUserId,
  refreshAccessTokenIfNeeded,
  refreshTokenIfNeeded,
} from '@/app/api/auth/oauth/utils'

const mockDbTyped = db as any
const mockRefreshOAuthToken = refreshOAuthToken as any

describe('OAuth Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(mockSession)
    mockDbTyped.limit.mockReturnValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserId', () => {
    it('should get user ID from session when no workflowId is provided', async () => {
      const userId = await getUserId('request-id')

      expect(userId).toBe('test-user-id')
    })

    it('should get user ID from workflow when workflowId is provided', async () => {
      mockDbTyped.limit.mockReturnValueOnce([{ userId: 'workflow-owner-id' }])

      const userId = await getUserId('request-id', 'workflow-id')

      expect(mockDbTyped.select).toHaveBeenCalled()
      expect(mockDbTyped.from).toHaveBeenCalled()
      expect(mockDbTyped.where).toHaveBeenCalled()
      expect(mockDbTyped.limit).toHaveBeenCalledWith(1)
      expect(userId).toBe('workflow-owner-id')
    })

    it('should return undefined if no session is found', async () => {
      mockGetSession.mockResolvedValueOnce(null)

      const userId = await getUserId('request-id')

      expect(userId).toBeUndefined()
    })

    it('should return undefined if workflow is not found', async () => {
      mockDbTyped.limit.mockReturnValueOnce([])

      const userId = await getUserId('request-id', 'nonexistent-workflow-id')

      expect(userId).toBeUndefined()
    })
  })

  describe('getCredential', () => {
    it('should return credential when found', async () => {
      const mockCredential = { id: 'credential-id', userId: 'test-user-id' }
      mockDbTyped.limit.mockReturnValueOnce([mockCredential])

      const credential = await getCredential('request-id', 'credential-id', 'test-user-id')

      expect(mockDbTyped.select).toHaveBeenCalled()
      expect(mockDbTyped.from).toHaveBeenCalled()
      expect(mockDbTyped.where).toHaveBeenCalled()
      expect(mockDbTyped.limit).toHaveBeenCalledWith(1)

      expect(credential).toEqual(mockCredential)
    })

    it('should return undefined when credential is not found', async () => {
      mockDbTyped.limit.mockReturnValueOnce([])

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

      const result = await refreshTokenIfNeeded('request-id', mockCredential, 'credential-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDbTyped.update).toHaveBeenCalled()
      expect(mockDbTyped.set).toHaveBeenCalled()
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
      mockDbTyped.limit.mockReturnValueOnce([mockCredential])

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
      mockDbTyped.limit.mockReturnValueOnce([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce({
        accessToken: 'new-token',
        expiresIn: 3600,
        refreshToken: 'new-refresh-token',
      })

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(mockRefreshOAuthToken).toHaveBeenCalledWith('google', 'refresh-token')
      expect(mockDbTyped.update).toHaveBeenCalled()
      expect(mockDbTyped.set).toHaveBeenCalled()
      expect(token).toBe('new-token')
    })

    it('should return null if credential not found', async () => {
      mockDbTyped.limit.mockReturnValueOnce([])

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
      mockDbTyped.limit.mockReturnValueOnce([mockCredential])

      mockRefreshOAuthToken.mockResolvedValueOnce(null)

      const token = await refreshAccessTokenIfNeeded('credential-id', 'test-user-id', 'request-id')

      expect(token).toBeNull()
    })
  })
})
