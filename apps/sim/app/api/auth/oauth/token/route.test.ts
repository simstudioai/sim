/**
 * Tests for OAuth token API routes
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetUserId,
  mockGetCredential,
  mockRefreshTokenIfNeeded,
  mockGetOAuthToken,
  mockAuthorizeCredentialUse,
  mockCheckSessionOrInternalAuth,
  mockLogger,
} = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  return {
    mockGetUserId: vi.fn(),
    mockGetCredential: vi.fn(),
    mockRefreshTokenIfNeeded: vi.fn(),
    mockGetOAuthToken: vi.fn(),
    mockAuthorizeCredentialUse: vi.fn(),
    mockCheckSessionOrInternalAuth: vi.fn(),
    mockLogger: logger,
  }
})

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getUserId: mockGetUserId,
  getCredential: mockGetCredential,
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
  getOAuthToken: mockGetOAuthToken,
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: vi.fn(),
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
  checkInternalAuth: vi.fn(),
}))

import { GET, POST } from '@/app/api/auth/oauth/token/route'

describe('OAuth Token API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * POST route tests
   */
  describe('POST handler', () => {
    it('should return access token successfully', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(mockGetCredential).toHaveBeenCalled()
      expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle workflowId for server-side authentication', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'internal_jwt',
        requesterUserId: 'workflow-owner-id',
        credentialOwnerUserId: 'workflow-owner-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'workflow-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(mockGetCredential).toHaveBeenCalled()
    })

    it('should handle missing credentialId', async () => {
      const req = createMockRequest('POST', {})

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty(
        'error',
        'Either credentialId or (credentialAccountUserId + providerId) is required'
      )
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle authentication failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: false,
        error: 'Authentication required',
      })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should handle workflow not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({ ok: false, error: 'Workflow not found' })

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'nonexistent-workflow-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
    })

    it('should handle credential not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'nonexistent-credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error')
    })

    it('should handle token refresh failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'owner-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockRejectedValueOnce(new Error('Refresh failure'))

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Failed to refresh access token')
    })

    describe('credentialAccountUserId + providerId path', () => {
      it('should reject unauthenticated requests', async () => {
        mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: false,
          error: 'Authentication required',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'target-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data).toHaveProperty('error', 'User not authenticated')
        expect(mockGetOAuthToken).not.toHaveBeenCalled()
      })

      it('should reject internal JWT authentication', async () => {
        mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'internal_jwt',
          userId: 'test-user-id',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(401)
        expect(data).toHaveProperty('error', 'User not authenticated')
        expect(mockGetOAuthToken).not.toHaveBeenCalled()
      })

      it('should reject requests for other users credentials', async () => {
        mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'attacker-user-id',
        })

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'victim-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(403)
        expect(data).toHaveProperty('error', 'Unauthorized')
        expect(mockGetOAuthToken).not.toHaveBeenCalled()
      })

      it('should allow session-authenticated users to access their own credentials', async () => {
        mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'test-user-id',
        })
        mockGetOAuthToken.mockResolvedValueOnce('valid-access-token')

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'google',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data).toHaveProperty('accessToken', 'valid-access-token')
        expect(mockGetOAuthToken).toHaveBeenCalledWith('test-user-id', 'google')
      })

      it('should return 404 when credential not found for user', async () => {
        mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
          success: true,
          authType: 'session',
          userId: 'test-user-id',
        })
        mockGetOAuthToken.mockResolvedValueOnce(null)

        const req = createMockRequest('POST', {
          credentialAccountUserId: 'test-user-id',
          providerId: 'nonexistent-provider',
        })

        const response = await POST(req)
        const data = await response.json()

        expect(response.status).toBe(404)
        expect(data.error).toContain('No credential found')
      })
    })
  })

  /**
   * GET route tests
   */
  describe('GET handler', () => {
    it('should return access token successfully', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockResolvedValueOnce({
        accessToken: 'fresh-token',
        refreshed: false,
      })

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockAuthorizeCredentialUse).toHaveBeenCalled()
      expect(mockGetCredential).toHaveBeenCalled()
      expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle missing credentialId', async () => {
      const req = new Request('http://localhost:3000/api/auth/oauth/token')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Credential ID is required')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle authentication failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: false,
        error: 'Authentication required',
      })

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data).toHaveProperty('error')
    })

    it('should handle credential not found', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      mockGetCredential.mockResolvedValueOnce(undefined)

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=nonexistent-credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error')
    })

    it('should handle missing access token', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: null,
        refreshToken: 'refresh-token',
        providerId: 'google',
      })

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error')
    })

    it('should handle token refresh failure', async () => {
      mockAuthorizeCredentialUse.mockResolvedValueOnce({
        ok: true,
        authType: 'session',
        requesterUserId: 'test-user-id',
        credentialOwnerUserId: 'test-user-id',
      })
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired
        providerId: 'google',
      })
      mockRefreshTokenIfNeeded.mockRejectedValueOnce(new Error('Refresh failure'))

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error')
    })
  })
})
