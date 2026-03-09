/**
 * Tests for copilot stats API route
 *
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateCopilotRequestSessionOnly,
  mockCreateUnauthorizedResponse,
  mockCreateBadRequestResponse,
  mockCreateInternalServerErrorResponse,
  mockCreateRequestTracker,
  mockFetch,
} = vi.hoisted(() => ({
  mockAuthenticateCopilotRequestSessionOnly: vi.fn(),
  mockCreateUnauthorizedResponse: vi.fn(),
  mockCreateBadRequestResponse: vi.fn(),
  mockCreateInternalServerErrorResponse: vi.fn(),
  mockCreateRequestTracker: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/copilot/request-helpers', () => ({
  authenticateCopilotRequestSessionOnly: mockAuthenticateCopilotRequestSessionOnly,
  createUnauthorizedResponse: mockCreateUnauthorizedResponse,
  createBadRequestResponse: mockCreateBadRequestResponse,
  createInternalServerErrorResponse: mockCreateInternalServerErrorResponse,
  createRequestTracker: mockCreateRequestTracker,
}))

vi.mock('@/lib/copilot/constants', () => ({
  SIM_AGENT_API_URL_DEFAULT: 'https://agent.sim.example.com',
  SIM_AGENT_API_URL: 'https://agent.sim.example.com',
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    COPILOT_API_KEY: 'test-api-key',
  },
  getEnv: vi.fn((key: string) => {
    const vals: Record<string, string | undefined> = {
      COPILOT_API_KEY: 'test-api-key',
    }
    return vals[key]
  }),
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
  isFalsy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false,
}))

import { POST } from '@/app/api/copilot/stats/route'

describe('Copilot Stats API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch

    mockCreateUnauthorizedResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    )
    mockCreateBadRequestResponse.mockImplementation(
      (message: string) => new Response(JSON.stringify({ error: message }), { status: 400 })
    )
    mockCreateInternalServerErrorResponse.mockImplementation(
      (message: string) => new Response(JSON.stringify({ error: message }), { status: 500 })
    )
    mockCreateRequestTracker.mockReturnValue({
      requestId: 'test-request-id',
      getDuration: vi.fn().mockReturnValue(100),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Invalid message ID' })
    })

    it('should handle upstream error with message field', async () => {
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Rate limit exceeded' })
    })

    it('should handle upstream error with no JSON response', async () => {
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData).toEqual({ success: false, error: 'Upstream error' })
    })

    it('should handle network errors gracefully', async () => {
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
      mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
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
