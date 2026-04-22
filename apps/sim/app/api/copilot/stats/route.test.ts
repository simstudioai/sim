/**
 * Tests for copilot stats API route
 *
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns, createEnvMock, createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/constants', () => ({
  SIM_AGENT_API_URL_DEFAULT: 'https://agent.sim.example.com',
  SIM_AGENT_API_URL: 'https://agent.sim.example.com',
}))

vi.mock('@/lib/core/config/env', () => createEnvMock({ COPILOT_API_KEY: 'test-api-key' }))

import { POST } from '@/app/api/copilot/stats/route'

// `fetchGo` reads `response.status` and `response.headers.get('content-length')`
// to stamp span attributes, so mock responses need both fields or the call
// path throws before the route handler sees the body.
function buildMockResponse(init: {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}): Record<string, unknown> {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    headers: new Headers(),
    json: init.json,
  }
}

describe('Copilot Stats API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: null,
        isAuthenticated: false,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should successfully forward stats to Sim Agent', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
      )

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: true,
      })

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
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 for invalid request body - missing diffCreated', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 for invalid request body - missing diffAccepted', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should return 400 when upstream Sim Agent returns error', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: false,
          json: () => Promise.resolve({ error: 'Invalid message ID' }),
        })
      )

      const req = createMockRequest('POST', {
        messageId: 'invalid-message',
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Invalid message ID' })
    })

    it('should handle upstream error with message field', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: false,
          json: () => Promise.resolve({ message: 'Rate limit exceeded' }),
        })
      )

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Rate limit exceeded' })
    })

    it('should handle upstream error with no JSON response', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: false,
          json: () => Promise.reject(new Error('Not JSON')),
        })
      )

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Upstream error' })
    })

    it('should handle network errors gracefully', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const req = createMockRequest('POST', {
        messageId: 'message-123',
        diffCreated: true,
        diffAccepted: false,
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to forward copilot stats')
    })

    it('should handle JSON parsing errors in request body', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Invalid request body for copilot stats')
    })

    it('should forward stats with diffCreated=false and diffAccepted=false', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      mockFetch.mockResolvedValueOnce(
        buildMockResponse({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
      )

      const req = createMockRequest('POST', {
        messageId: 'message-456',
        diffCreated: false,
        diffAccepted: false,
      })

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
