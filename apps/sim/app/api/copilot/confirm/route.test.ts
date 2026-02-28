/**
 * Tests for copilot confirm API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockRedisExists, mockRedisSet, mockGetRedisClient } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRedisExists: vi.fn(),
  mockRedisSet: vi.fn(),
  mockGetRedisClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { POST } from '@/app/api/copilot/confirm/route'

describe('Copilot Confirm API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const mockRedisClient = {
      exists: mockRedisExists,
      set: mockRedisSet,
    }

    mockGetRedisClient.mockReturnValue(mockRedisClient)
    mockRedisExists.mockResolvedValue(1)
    mockRedisSet.mockResolvedValue('OK')

    vi.spyOn(global, 'setTimeout').mockImplementation((callback, _delay) => {
      if (typeof callback === 'function') {
        setImmediate(callback)
      }
      return setTimeout(() => {}, 0) as unknown as NodeJS.Timeout
    })

    let mockTime = 1640995200000
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 10000
      return mockTime
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createMockPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost:3000/api/copilot/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function setAuthenticated() {
    mockGetSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com', name: 'Test User' },
    })
  }

  function setUnauthenticated() {
    mockGetSession.mockResolvedValue(null)
  }

  describe('POST', () => {
    it('should return 401 when user is not authenticated', async () => {
      setUnauthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({ error: 'Unauthorized' })
    })

    it('should return 400 for invalid request body - missing toolCallId', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Required')
    })

    it('should return 400 for invalid request body - missing status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid request data')
    })

    it('should return 400 for invalid status value', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'invalid-status',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Invalid notification status')
    })

    it('should successfully confirm tool call with success status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool executed successfully',
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      expect(mockRedisSet).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with error status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-456',
        status: 'error',
        message: 'Tool execution failed',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool execution failed',
        toolCallId: 'tool-call-456',
        status: 'error',
      })

      expect(mockRedisSet).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with accepted status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-789',
        status: 'accepted',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool call tool-call-789 has been accepted',
        toolCallId: 'tool-call-789',
        status: 'accepted',
      })

      expect(mockRedisSet).toHaveBeenCalled()
    })

    it('should successfully confirm tool call with rejected status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-101',
        status: 'rejected',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Tool call tool-call-101 has been rejected',
        toolCallId: 'tool-call-101',
        status: 'rejected',
      })
    })

    it('should successfully confirm tool call with background status', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: 'tool-call-bg',
        status: 'background',
        message: 'Moved to background execution',
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        message: 'Moved to background execution',
        toolCallId: 'tool-call-bg',
        status: 'background',
      })
    })

    it('should return 400 when Redis client is not available', async () => {
      setAuthenticated()

      mockGetRedisClient.mockReturnValue(null)

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should return 400 when Redis set fails', async () => {
      setAuthenticated()

      mockRedisSet.mockRejectedValueOnce(new Error('Redis set failed'))

      const req = createMockPostRequest({
        toolCallId: 'non-existent-tool',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    }, 10000)

    it('should handle Redis errors gracefully', async () => {
      setAuthenticated()

      mockRedisSet.mockRejectedValueOnce(new Error('Redis connection failed'))

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should handle Redis set operation failure', async () => {
      setAuthenticated()

      mockRedisExists.mockResolvedValue(1)
      mockRedisSet.mockRejectedValue(new Error('Redis set failed'))

      const req = createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toBe('Failed to update tool call status or tool call not found')
    })

    it('should handle JSON parsing errors in request body', async () => {
      setAuthenticated()

      const req = new NextRequest('http://localhost:3000/api/copilot/confirm', {
        method: 'POST',
        body: '{invalid-json',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.error).toContain('JSON')
    })

    it('should validate empty toolCallId', async () => {
      setAuthenticated()

      const req = createMockPostRequest({
        toolCallId: '',
        status: 'success',
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.error).toContain('Tool call ID is required')
    })

    it('should handle all valid status types', async () => {
      setAuthenticated()

      const validStatuses = ['success', 'error', 'accepted', 'rejected', 'background']

      for (const status of validStatuses) {
        const req = createMockPostRequest({
          toolCallId: `tool-call-${status}`,
          status,
        })

        const response = await POST(req)

        expect(response.status).toBe(200)
        const responseData = await response.json()
        expect(responseData.success).toBe(true)
        expect(responseData.status).toBe(status)
        expect(responseData.toolCallId).toBe(`tool-call-${status}`)
      }
    })
  })
})
