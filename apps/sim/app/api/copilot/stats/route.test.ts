/**
 * Tests for copilot stats API route
 *
 * @vitest-environment node
 */
import { createMockRequest, mockCryptoUuid, setupCommonApiMocks } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot Stats API Route', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    global.fetch = mockFetch

    vi.doMock('@/lib/copilot/request-helpers', () => ({
      authenticateCopilotRequestSessionOnly: vi.fn(),
      createUnauthorizedResponse: vi
        .fn()
        .mockReturnValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
      createBadRequestResponse: vi
        .fn()
        .mockImplementation(
          (message) => new Response(JSON.stringify({ error: message }), { status: 400 })
        ),
      createInternalServerErrorResponse: vi
        .fn()
        .mockImplementation(
          (message) => new Response(JSON.stringify({ error: message }), { status: 500 })
        ),
      createRequestTracker: vi.fn().mockReturnValue({
        requestId: 'test-request-id',
        getDuration: vi.fn().mockReturnValue(100),
      }),
    }))

    vi.doMock('@/lib/copilot/constants', () => ({
      SIM_AGENT_API_URL_DEFAULT: 'https://agent.sim.example.com',
    }))

    vi.doMock('@/lib/core/config/env', async () => {
      const { createEnvMock } = await import('@sim/testing')
      return createEnvMock({
        SIM_AGENT_API_URL: undefined,
        COPILOT_API_KEY: 'test-api-key',
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should successfully forward stats to Sim Agent', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: true,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: true })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.sim.example.com/api/stats',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'test-api-key',
          }),
          body: JSON.stringify({
            messageId: 'message-123',
            diffCreated: true,
            diffAccepted: true,
          }),
        })
      )
    })

    it('should return 400 for invalid request body - missing messageId', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 for invalid request body - missing diffCreated', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 for invalid request body - missing diffAccepted', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 when upstream Sim Agent returns error', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid message ID' }),
      })

      const req = createMockRequest('POST', {
        messageId: 'invalid-message',
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Invalid message ID' })
    })

    it('should handle upstream error with message field', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Rate limit exceeded' })
    })

    it('should handle upstream error with no JSON response', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.reject(new Error('Not JSON')),
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Upstream error' })
    })

    it('should handle network errors gracefully', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to forward copilot stats')
    })

    it('should handle JSON parsing errors in request body', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/stats', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should forward stats with diffCreated=false and diffAccepted=false', async () => {
      const { authenticateCopilotRequestSessionOnly } = await import(
        '@/lib/copilot/request-helpers'
      )
      vi.mocked(authenticateCopilotRequestSessionOnly).mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const req = createMockRequest('POST', {
        messageId: 'message-456',
        diffCreated: false,
        diffAccepted: false,
      })

      const { POST } = await import('@/app/api/copilot/stats/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            messageId: 'message-456',
            diffCreated: false,
            diffAccepted: false,
          }),
        })
      )
    })
  })
})
