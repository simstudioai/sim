/**
 * Tests for OAuth token API routes
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('OAuth Token API Routes', () => {
  const mockGetUserId = vi.fn()
  const mockGetCredential = vi.fn()
  const mockRefreshTokenIfNeeded = vi.fn()

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'
  const mockRequestId = mockUUID.slice(0, 8)

  beforeEach(() => {
    vi.resetModules()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    vi.doMock('../utils', () => ({
      getUserId: mockGetUserId,
      getCredential: mockGetCredential,
      refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * POST route tests
   */
  describe('POST handler', () => {
    it('should return access token successfully', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
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

      // Create mock request
      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      // Import handler after setting up mocks
      const { POST } = await import('./route')

      // Call handler
      const response = await POST(req)
      const data = await response.json()

      // Verify request was handled correctly
      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      // Verify mocks were called correctly
      expect(mockGetUserId).toHaveBeenCalledWith(mockRequestId, undefined)
      expect(mockGetCredential).toHaveBeenCalledWith(mockRequestId, 'credential-id', 'test-user-id')
      expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle workflowId for server-side authentication', async () => {
      mockGetUserId.mockResolvedValueOnce('workflow-owner-id')
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

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockGetUserId).toHaveBeenCalledWith(mockRequestId, 'workflow-id')
      expect(mockGetCredential).toHaveBeenCalledWith(
        mockRequestId,
        'credential-id',
        'workflow-owner-id'
      )
    })

    it('should handle missing credentialId', async () => {
      const req = createMockRequest('POST', {})

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Credential ID is required')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle authentication failure', async () => {
      mockGetUserId.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
      })

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'User not authenticated')
    })

    it('should handle workflow not found', async () => {
      mockGetUserId.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'credential-id',
        workflowId: 'nonexistent-workflow-id',
      })

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Workflow not found')
    })

    it('should handle credential not found', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
      mockGetCredential.mockResolvedValueOnce(undefined)

      const req = createMockRequest('POST', {
        credentialId: 'nonexistent-credential-id',
      })

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Credential not found')
    })

    it('should handle token refresh failure', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
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

      const { POST } = await import('./route')

      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Failed to refresh access token')
    })
  })

  /**
   * GET route tests
   */
  describe('GET handler', () => {
    it('should return access token successfully', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
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

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('accessToken', 'fresh-token')

      expect(mockGetUserId).toHaveBeenCalledWith(mockRequestId)
      expect(mockGetCredential).toHaveBeenCalledWith(mockRequestId, 'credential-id', 'test-user-id')
      expect(mockRefreshTokenIfNeeded).toHaveBeenCalled()
    })

    it('should handle missing credentialId', async () => {
      const req = new Request('http://localhost:3000/api/auth/oauth/token')

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'Credential ID is required')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle authentication failure', async () => {
      mockGetUserId.mockResolvedValueOnce(undefined)

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'User not authenticated')
    })

    it('should handle credential not found', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
      mockGetCredential.mockResolvedValueOnce(undefined)

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=nonexistent-credential-id'
      )

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data).toHaveProperty('error', 'Credential not found')
    })

    it('should handle missing access token', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
      mockGetCredential.mockResolvedValueOnce({
        id: 'credential-id',
        accessToken: null,
        refreshToken: 'refresh-token',
        providerId: 'google',
      })

      const req = new Request(
        'http://localhost:3000/api/auth/oauth/token?credentialId=credential-id'
      )

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data).toHaveProperty('error', 'No access token available')
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('should handle token refresh failure', async () => {
      mockGetUserId.mockResolvedValueOnce('test-user-id')
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

      const { GET } = await import('./route')

      const response = await GET(req as any)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data).toHaveProperty('error', 'Failed to refresh access token')
    })
  })
})
