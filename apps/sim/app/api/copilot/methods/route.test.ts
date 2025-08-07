/**
 * Tests for copilot methods API route
 *
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockCryptoUuid,
  setupCommonApiMocks,
} from '@/app/api/__test-utils__/utils'

describe('Copilot Methods API Route', () => {
  const mockRedisGet = vi.fn()
  const mockRedisSet = vi.fn()
  const mockGetRedisClient = vi.fn()
  const mockToolRegistryHas = vi.fn()
  const mockToolRegistryGet = vi.fn()
  const mockToolRegistryExecute = vi.fn()
  const mockToolRegistryGetAvailableIds = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    setupCommonApiMocks()
    mockCryptoUuid()

    // Mock Redis client
    const mockRedisClient = {
      get: mockRedisGet,
      set: mockRedisSet,
    }

    mockGetRedisClient.mockReturnValue(mockRedisClient)
    mockRedisGet.mockResolvedValue(null)
    mockRedisSet.mockResolvedValue('OK')

    vi.doMock('@/lib/redis', () => ({
      getRedisClient: mockGetRedisClient,
    }))

    // Mock tool registry
    const mockToolRegistry = {
      has: mockToolRegistryHas,
      get: mockToolRegistryGet,
      execute: mockToolRegistryExecute,
      getAvailableIds: mockToolRegistryGetAvailableIds,
    }

    mockToolRegistryHas.mockReturnValue(true)
    mockToolRegistryGet.mockReturnValue({ requiresInterrupt: false })
    mockToolRegistryExecute.mockResolvedValue({ success: true, data: 'Tool executed successfully' })
    mockToolRegistryGetAvailableIds.mockReturnValue(['test-tool', 'another-tool'])

    vi.doMock('@/lib/copilot/tools/server-tools/registry', () => ({
      copilotToolRegistry: mockToolRegistry,
    }))

    // Mock environment variables
    vi.doMock('@/lib/env', () => ({
      env: {
        INTERNAL_API_SECRET: 'test-secret-key',
      },
    }))

    // Mock setTimeout for polling
    vi.spyOn(global, 'setTimeout').mockImplementation((callback, _delay) => {
      if (typeof callback === 'function') {
        setImmediate(callback)
      }
      return setTimeout(() => {}, 0) as any
    })

    // Mock Date.now for timeout control
    let mockTime = 1640995200000
    vi.spyOn(Date, 'now').mockImplementation(() => {
      mockTime += 1000 // Add 1 second each call
      return mockTime
    })

    // Mock crypto.randomUUID for request IDs
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-request-id')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('POST', () => {
    it('should return 401 when API key is missing', async () => {
      const req = createMockRequest('POST', {
        methodId: 'test-tool',
        params: {},
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: false,
        error: 'API key required',
      })
    })

    it('should return 401 when API key is invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'invalid-key',
        },
        body: JSON.stringify({
          methodId: 'test-tool',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: false,
        error: 'Invalid API key',
      })
    })

    it('should return 401 when internal API key is not configured', async () => {
      // Mock environment with no API key
      vi.doMock('@/lib/env', () => ({
        env: {
          INTERNAL_API_SECRET: undefined,
        },
      }))

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'any-key',
        },
        body: JSON.stringify({
          methodId: 'test-tool',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(401)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: false,
        error: 'Internal API key not configured',
      })
    })

    it('should return 400 for invalid request body - missing methodId', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          params: {},
          // Missing methodId
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('Required')
    })

    it('should return 400 for empty methodId', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: '',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('Method ID is required')
    })

    it('should return 400 when tool is not found in registry', async () => {
      mockToolRegistryHas.mockReturnValue(false)

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'unknown-tool',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('Unknown method: unknown-tool')
      expect(responseData.error).toContain('Available methods: test-tool, another-tool')
    })

    it('should successfully execute a tool without interruption', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'test-tool',
          params: { key: 'value' },
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      expect(mockToolRegistryExecute).toHaveBeenCalledWith('test-tool', { key: 'value' })
    })

    it('should handle tool execution with default empty params', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'test-tool',
          // No params provided
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      expect(mockToolRegistryExecute).toHaveBeenCalledWith('test-tool', {})
    })

    it('should return 400 when tool requires interrupt but no toolCallId provided', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          // No toolCallId provided
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(400)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe(
        'This tool requires approval but no tool call ID was provided'
      )
    })

    it('should handle tool execution with interrupt - user approval', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return accepted status immediately (simulate quick approval)
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'accepted', message: 'User approved' })
      )

      // Reset Date.now mock to not trigger timeout
      let mockTime = 1640995200000
      vi.spyOn(Date, 'now').mockImplementation(() => {
        mockTime += 100 // Small increment to avoid timeout
        return mockTime
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: { key: 'value' },
          toolCallId: 'tool-call-123',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      // Verify Redis operations
      expect(mockRedisSet).toHaveBeenCalledWith(
        'tool_call:tool-call-123',
        expect.stringContaining('"status":"pending"'),
        'EX',
        86400
      )
      expect(mockRedisGet).toHaveBeenCalledWith('tool_call:tool-call-123')
      expect(mockToolRegistryExecute).toHaveBeenCalledWith('interrupt-tool', {
        key: 'value',
        confirmationMessage: 'User approved',
        fullData: {
          message: 'User approved',
          status: 'accepted',
        },
      })
    })

    it('should handle tool execution with interrupt - user rejection', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return rejected status
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'rejected', message: 'User rejected' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-456',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200) // User rejection returns 200
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe(
        'The user decided to skip running this tool. This was a user decision.'
      )

      // Tool should not be executed when rejected
      expect(mockToolRegistryExecute).not.toHaveBeenCalled()
    })

    it('should handle tool execution with interrupt - error status', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return error status
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'error', message: 'Tool execution failed' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-error',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Tool execution failed')
    })

    it('should handle tool execution with interrupt - background status', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return background status
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'background', message: 'Running in background' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-bg',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      expect(mockToolRegistryExecute).toHaveBeenCalled()
    })

    it('should handle tool execution with interrupt - success status', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return success status
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'success', message: 'Completed successfully' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-success',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      expect(mockToolRegistryExecute).toHaveBeenCalled()
    })

    it('should handle tool execution with interrupt - timeout', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to never return a status (timeout scenario)
      mockRedisGet.mockResolvedValue(null)

      // Mock Date.now to trigger timeout quickly
      let mockTime = 1640995200000
      vi.spyOn(Date, 'now').mockImplementation(() => {
        mockTime += 100000 // Add 100 seconds each call to trigger timeout
        return mockTime
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-timeout',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(408) // Request Timeout
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Tool execution request timed out')

      expect(mockToolRegistryExecute).not.toHaveBeenCalled()
    })

    it('should handle unexpected status in interrupt flow', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return unexpected status
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'unknown-status', message: 'Unknown' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-unknown',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Unexpected tool call status: unknown-status')
    })

    it('should handle Redis client unavailable for interrupt flow', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })
      mockGetRedisClient.mockReturnValue(null)

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-no-redis',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(408) // Timeout due to Redis unavailable
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Tool execution request timed out')
    })

    it('should handle no_op tool with confirmation message', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return accepted status with message
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ status: 'accepted', message: 'Confirmation message' })
      )

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'no_op',
          params: { existing: 'param' },
          toolCallId: 'tool-call-noop',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)

      // Verify confirmation message was added to params
      expect(mockToolRegistryExecute).toHaveBeenCalledWith('no_op', {
        existing: 'param',
        confirmationMessage: 'Confirmation message',
        fullData: {
          message: 'Confirmation message',
          status: 'accepted',
        },
      })
    })

    it('should handle Redis errors in interrupt flow', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to throw an error
      mockRedisGet.mockRejectedValue(new Error('Redis connection failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-redis-error',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(408) // Timeout due to Redis error
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Tool execution request timed out')
    })

    it('should handle tool execution failure', async () => {
      mockToolRegistryExecute.mockResolvedValue({
        success: false,
        error: 'Tool execution failed',
      })

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'failing-tool',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200) // Still returns 200, but with success: false
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: false,
        error: 'Tool execution failed',
      })
    })

    it('should handle JSON parsing errors in request body', async () => {
      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: '{invalid-json',
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('JSON')
    })

    it('should handle tool registry execution throwing an error', async () => {
      mockToolRegistryExecute.mockRejectedValue(new Error('Registry execution failed'))

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'error-tool',
          params: {},
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(500)
      const responseData = await response.json()
      expect(responseData.success).toBe(false)
      expect(responseData.error).toBe('Registry execution failed')
    })

    it('should handle old format Redis status (string instead of JSON)', async () => {
      mockToolRegistryGet.mockReturnValue({ requiresInterrupt: true })

      // Mock Redis to return old format (direct status string)
      mockRedisGet.mockResolvedValue('accepted')

      const req = new NextRequest('http://localhost:3000/api/copilot/methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'test-secret-key',
        },
        body: JSON.stringify({
          methodId: 'interrupt-tool',
          params: {},
          toolCallId: 'tool-call-old-format',
        }),
      })

      const { POST } = await import('@/app/api/copilot/methods/route')
      const response = await POST(req)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData).toEqual({
        success: true,
        data: 'Tool executed successfully',
      })

      expect(mockToolRegistryExecute).toHaveBeenCalled()
    })
  })
})
