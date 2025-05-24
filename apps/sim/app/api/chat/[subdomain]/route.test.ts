/**
 * Tests for chat subdomain API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Chat Subdomain API Route', () => {
  const mockWorkflowSingleOutput = {
    id: 'response-id',
    content: 'Test response',
    timestamp: new Date().toISOString(),
    type: 'workflow',
  }

  // Mock functions
  const mockAddCorsHeaders = vi.fn().mockImplementation((response) => response)
  const mockValidateChatAuth = vi.fn().mockResolvedValue({ authorized: true })
  const mockSetChatAuthCookie = vi.fn()
  const mockExecuteWorkflowForChat = vi.fn().mockResolvedValue(mockWorkflowSingleOutput)

  // Mock database return values
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
    },
  ]

  beforeEach(() => {
    vi.resetModules()

    // Mock chat API utils
    vi.doMock('../utils', () => ({
      addCorsHeaders: mockAddCorsHeaders,
      validateChatAuth: mockValidateChatAuth,
      setChatAuthCookie: mockSetChatAuthCookie,
      validateAuthToken: vi.fn().mockReturnValue(true),
      executeWorkflowForChat: mockExecuteWorkflowForChat,
    }))

    // Mock logger
    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    // Mock database
    vi.doMock('@/db', () => {
      const mockLimitChat = vi.fn().mockReturnValue(mockChatResult)
      const mockWhereChat = vi.fn().mockReturnValue({ limit: mockLimitChat })

      const mockLimitWorkflow = vi.fn().mockReturnValue(mockWorkflowResult)
      const mockWhereWorkflow = vi.fn().mockReturnValue({ limit: mockLimitWorkflow })

      const mockFrom = vi.fn().mockImplementation((table) => {
        // Check which table is being queried
        if (table === 'workflow') {
          return { where: mockWhereWorkflow }
        }
        return { where: mockWhereChat }
      })

      const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

      return {
        db: {
          select: mockSelect,
        },
      }
    })

    // Mock API response helpers
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

      const { GET } = await import('./route')

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

      const { GET } = await import('./route')

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

      const { GET } = await import('./route')

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

      const { GET } = await import('./route')

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
    it('should handle authentication requests without messages', async () => {
      const req = createMockRequest('POST', { password: 'test-password' })
      const params = Promise.resolve({ subdomain: 'password-protected-chat' })

      const { POST } = await import('./route')

      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('authenticated', true)

      expect(mockSetChatAuthCookie).toHaveBeenCalled()
    })

    it('should return 400 for requests without message', async () => {
      const req = createMockRequest('POST', {})
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('./route')

      const response = await POST(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'No message provided')
    })

    it('should return 401 for unauthorized access', async () => {
      const originalValidateChatAuth = mockValidateChatAuth.getMockImplementation()
      mockValidateChatAuth.mockImplementationOnce(async () => ({
        authorized: false,
        error: 'Authentication required',
      }))

      const req = createMockRequest('POST', { message: 'Hello' })
      const params = Promise.resolve({ subdomain: 'protected-chat' })

      const { POST } = await import('./route')

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
      vi.doMock('@/db', () => {
        const mockLimitChat = vi.fn().mockReturnValue([
          {
            id: 'chat-id',
            workflowId: 'unavailable-workflow',
            isActive: true,
            authType: 'public',
          },
        ])
        const mockWhereChat = vi.fn().mockReturnValue({ limit: mockLimitChat })

        // Second call returns non-deployed workflow
        const mockLimitWorkflow = vi.fn().mockReturnValue([
          {
            isDeployed: false,
          },
        ])
        const mockWhereWorkflow = vi.fn().mockReturnValue({ limit: mockLimitWorkflow })

        // Mock from function to return different where implementations
        const mockFrom = vi
          .fn()
          .mockImplementationOnce(() => ({ where: mockWhereChat })) // First call (chat)
          .mockImplementationOnce(() => ({ where: mockWhereWorkflow })) // Second call (workflow)

        const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

        return {
          db: {
            select: mockSelect,
          },
        }
      })

      const req = createMockRequest('POST', { message: 'Hello' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('./route')

      const response = await POST(req, { params })

      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Chat workflow is not available')
    })

    it('should handle workflow execution errors gracefully', async () => {
      const originalExecuteWorkflow = mockExecuteWorkflowForChat.getMockImplementation()
      mockExecuteWorkflowForChat.mockImplementationOnce(async () => {
        throw new Error('Execution failed')
      })

      const req = createMockRequest('POST', { message: 'Trigger error' })
      const params = Promise.resolve({ subdomain: 'test-chat' })

      const { POST } = await import('./route')

      const response = await POST(req, { params })

      expect(response.status).toBe(503)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Chat workflow is not available')

      if (originalExecuteWorkflow) {
        mockExecuteWorkflowForChat.mockImplementation(originalExecuteWorkflow)
      }
    })
  })
})
