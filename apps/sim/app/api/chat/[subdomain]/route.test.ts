/**
 * Tests for chat subdomain API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Chat Subdomain API Route', () => {
  const createMockStream = () => {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"blockId":"agent-1","chunk":"Hello"}\n\n')
        )
        controller.enqueue(
          new TextEncoder().encode('data: {"blockId":"agent-1","chunk":" world"}\n\n')
        )
        controller.enqueue(
          new TextEncoder().encode('data: {"event":"final","data":{"success":true}}\n\n')
        )
        controller.close()
      },
    })
  }

  const mockAddCorsHeaders = vi.fn().mockImplementation((response) => response)
  const mockValidateChatAuth = vi.fn().mockResolvedValue({ authorized: true })
  const mockSetChatAuthCookie = vi.fn()
  const mockExecuteWorkflowForChat = vi.fn().mockResolvedValue(createMockStream())

  const mockChatResult = [
    {
      id: 'chat-id',
      workflowId: 'workflow-id',
      userId: 'user-id',
      isActive: true,
      authType: 'public',
      title: 'Test Chat',
      description: 'Test chat description',
      customizations: {
        welcomeMessage: 'Welcome to the test chat',
        primaryColor: '#000000',
      },
      outputConfigs: [{ blockId: 'block-1', path: 'output' }],
    },
  ]

  const mockWorkflowResult = [
    {
      isDeployed: true,
      state: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      },
      deployedState: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      },
    },
  ]

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@/app/api/chat/utils', () => ({
      addCorsHeaders: mockAddCorsHeaders,
      validateChatAuth: mockValidateChatAuth,
      setChatAuthCookie: mockSetChatAuthCookie,
      validateAuthToken: vi.fn().mockReturnValue(true),
      executeWorkflowForChat: mockExecuteWorkflowForChat,
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    vi.doMock('@/db', () => {
      const mockSelect = vi.fn().mockImplementation((fields) => {
        if (fields && fields.isDeployed !== undefined) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue(mockWorkflowResult),
              }),
            }),
          }
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(mockChatResult),
            }),
          }),
        }
      })

      return {
        db: {
          select: mockSelect,
        },
        chat: {},
        workflow: {},
      }
    })

    vi.doMock('@/app/api/workflows/utils', () => ({
      createErrorResponse: vi.fn().mockImplementation((message, status, code) => {
        return new Response(
          JSON.stringify({
            error: code || 'Error',
            message,
          }),
          { status }
        )
      }),
      createSuccessResponse: vi.fn().mockImplementation((data) => {
        return new Response(JSON.stringify(data), { status: 200 })
      }),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET endpoint', () => {
    it('should return chat info for a valid subdomain', async () => {
      const req = createMockRequest('GET')
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { GET } = await import('@/app/api/chat/[subdomain]/route')

      const response = await GET(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('id', 'chat-id')
      expect(data).toHaveProperty('title', 'Test Chat')
      expect(data).toHaveProperty('description', 'Test chat description')
      expect(data).toHaveProperty('customizations')
      expect(data.customizations).toHaveProperty('welcomeMessage', 'Welcome to the test chat')
    })

    it('should return 404 for non-existent subdomain', async () => {
      vi.doMock('@/db', () => {
        const mockLimit = vi.fn().mockReturnValue([])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
        const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

        return {
          db: {
            select: mockSelect,
          },
        }
      })

      const req = createMockRequest('GET')
      const params = Promise.resolve({ subdomain: 'nonexistent' })

      const { GET } = await import('@/app/api/chat/[subdomain]/route')

      const response = await GET(req, { params })

      expect(response.status).toBe(404)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Chat not found')
    })

    it('should return 403 for inactive chat', async () => {
      vi.doMock('@/db', () => {
        const mockLimit = vi.fn().mockReturnValue([
          {
            id: 'chat-id',
            isActive: false,
            authType: 'public',
          },
        ])
        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
        const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

        return {
          db: {
            select: mockSelect,
          },
        }
      })

      const req = createMockRequest('GET')
      const params = Promise.resolve({ subdomain: 'inactive-chat' })

      const { GET } = await import('@/app/api/chat/[subdomain]/route')

      const response = await GET(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'This chat is currently unavailable')
    })

    it('should return 401 when authentication is required', async () => {
      const originalValidateChatAuth = mockValidateChatAuth.getMockImplementation()
      mockValidateChatAuth.mockImplementationOnce(async () => ({
        authorized: false,
        error: 'auth_required_password',
      }))

      const req = createMockRequest('GET')
      const params = Promise.resolve({ subdomain: 'password-protected-chat' })

      const { GET } = await import('@/app/api/chat/[subdomain]/route')

      const response = await GET(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'auth_required_password')

      if (originalValidateChatAuth) {
        mockValidateChatAuth.mockImplementation(originalValidateChatAuth)
      }
    })
  })

  describe('POST endpoint', () => {
    it('should handle authentication requests without input', async () => {
      const req = createMockRequest('POST', { password: 'test-password' })
      const params = Promise.resolve({ subdomain: 'password-protected-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('authenticated', true)

      expect(mockSetChatAuthCookie).toHaveBeenCalled()
    })

    it('should return 400 for requests without input', async () => {
      const req = createMockRequest('POST', {})
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'No input provided')
    })

    it('should return 401 for unauthorized access', async () => {
      const originalValidateChatAuth = mockValidateChatAuth.getMockImplementation()
      mockValidateChatAuth.mockImplementationOnce(async () => ({
        authorized: false,
        error: 'Authentication required',
      }))

      const req = createMockRequest('POST', { input: 'Hello' })
      const params = Promise.resolve({ subdomain: 'protected-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Authentication required')

      if (originalValidateChatAuth) {
        mockValidateChatAuth.mockImplementation(originalValidateChatAuth)
      }
    })

    it('should return 503 when workflow is not available', async () => {
      // Override the default workflow result to return non-deployed
      vi.doMock('@/db', () => {
        // Track call count to return different results
        let callCount = 0

        const mockLimit = vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            // First call - chat query
            return [
              {
                id: 'chat-id',
                workflowId: 'unavailable-workflow',
                userId: 'user-id',
                isActive: true,
                authType: 'public',
                outputConfigs: [{ blockId: 'block-1', path: 'output' }],
              },
            ]
          }
          if (callCount === 2) {
            // Second call - workflow query
            return [
              {
                isDeployed: false,
              },
            ]
          }
          return []
        })

        const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
        const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
        const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

        return {
          db: {
            select: mockSelect,
          },
          chat: {},
          workflow: {},
        }
      })

      const req = createMockRequest('POST', { input: 'Hello' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Chat workflow is not available')
    })

    it('should return streaming response for valid chat messages', async () => {
      const req = createMockRequest('POST', { input: 'Hello world', conversationId: 'conv-123' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(response.headers.get('Connection')).toBe('keep-alive')

      // Verify executeWorkflowForChat was called with correct parameters
      expect(mockExecuteWorkflowForChat).toHaveBeenCalledWith('chat-id', 'Hello world', 'conv-123')
    })

    it('should handle streaming response body correctly', async () => {
      const req = createMockRequest('POST', { input: 'Hello world' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      expect(response.body).toBeInstanceOf(ReadableStream)

      // Test that we can read from the response stream
      if (response.body) {
        const reader = response.body.getReader()
        const { value, done } = await reader.read()

        if (!done && value) {
          const chunk = new TextDecoder().decode(value)
          expect(chunk).toMatch(/^data: /)
        }

        reader.releaseLock()
      }
    })

    it('should handle workflow execution errors gracefully', async () => {
      const originalExecuteWorkflow = mockExecuteWorkflowForChat.getMockImplementation()
      mockExecuteWorkflowForChat.mockImplementationOnce(async () => {
        throw new Error('Execution failed')
      })

      const req = createMockRequest('POST', { input: 'Trigger error' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Execution failed')

      if (originalExecuteWorkflow) {
        mockExecuteWorkflowForChat.mockImplementation(originalExecuteWorkflow)
      }
    })

    it('should handle invalid JSON in request body', async () => {
      // Create a request with invalid JSON
      const req = {
        method: 'POST',
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as any

      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      const response = await POST(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Invalid request body')
    })

    it('should pass conversationId to executeWorkflowForChat when provided', async () => {
      const req = createMockRequest('POST', {
        input: 'Hello world',
        conversationId: 'test-conversation-123',
      })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      await POST(req, { params })

      expect(mockExecuteWorkflowForChat).toHaveBeenCalledWith(
        'chat-id',
        'Hello world',
        'test-conversation-123'
      )
    })

    it('should handle missing conversationId gracefully', async () => {
      const req = createMockRequest('POST', { input: 'Hello world' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('@/app/api/chat/[subdomain]/route')

      await POST(req, { params })

      expect(mockExecuteWorkflowForChat).toHaveBeenCalledWith('chat-id', 'Hello world', undefined)
    })
  })
})
