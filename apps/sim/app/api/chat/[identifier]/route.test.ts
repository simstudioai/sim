/**
 * Tests for chat identifier API route
 *
 * @vitest-environment node
 */
import { loggerMock, requestUtilsMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Creates a mock NextRequest with cookies support for testing.
 */
function createMockNextRequest(
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  url = 'http://localhost:3000/api/test'
): any {
  const headersObj = new Headers({
    'Content-Type': 'application/json',
    ...headers,
  })

  return {
    method,
    headers: headersObj,
    cookies: {
      get: vi.fn().mockReturnValue(undefined),
    },
    json:
      body !== undefined
        ? vi.fn().mockResolvedValue(body)
        : vi.fn().mockRejectedValue(new Error('No body')),
    url,
  }
}

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

const {
  mockDbSelect,
  mockAddCorsHeaders,
  mockValidateChatAuth,
  mockSetChatAuthCookie,
  mockValidateAuthToken,
  mockCreateErrorResponse,
  mockCreateSuccessResponse,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockAddCorsHeaders: vi.fn().mockImplementation((response: Response) => response),
  mockValidateChatAuth: vi.fn().mockResolvedValue({ authorized: true }),
  mockSetChatAuthCookie: vi.fn(),
  mockValidateAuthToken: vi.fn().mockReturnValue(false),
  mockCreateErrorResponse: vi
    .fn()
    .mockImplementation((message: string, status: number, code?: string) => {
      return new Response(
        JSON.stringify({
          error: code || 'Error',
          message,
        }),
        { status }
      )
    }),
  mockCreateSuccessResponse: vi.fn().mockImplementation((data: unknown) => {
    return new Response(JSON.stringify(data), { status: 200 })
  }),
}))

vi.mock('@sim/db', () => ({
  db: { select: mockDbSelect },
  chat: {},
  workflow: {},
}))

vi.mock('@/lib/core/security/deployment', () => ({
  addCorsHeaders: mockAddCorsHeaders,
  validateAuthToken: mockValidateAuthToken,
  setDeploymentAuthCookie: vi.fn(),
  isEmailAllowed: vi.fn().mockReturnValue(false),
}))

vi.mock('@/app/api/chat/utils', () => ({
  validateChatAuth: mockValidateChatAuth,
  setChatAuthCookie: mockSetChatAuthCookie,
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: mockCreateErrorResponse,
  createSuccessResponse: mockCreateSuccessResponse,
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: vi.fn().mockResolvedValue({
    success: true,
    actorUserId: 'test-user-id',
    workflowRecord: {
      id: 'test-workflow-id',
      userId: 'test-user-id',
      isDeployed: true,
      workspaceId: 'test-workspace-id',
      variables: {},
    },
    userSubscription: {
      plan: 'pro',
      status: 'active',
    },
    rateLimitInfo: {
      allowed: true,
      remaining: 100,
      resetAt: new Date(),
    },
  }),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(() => ({
    safeStart: vi.fn().mockResolvedValue(undefined),
    safeCompleteWithError: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/workflows/streaming/streaming', () => ({
  createStreamingResponse: vi.fn().mockImplementation(async () => createMockStream()),
}))

vi.mock('@/lib/core/utils/sse', () => ({
  SSE_HEADERS: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
}))

vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn().mockResolvedValue({ decrypted: 'test-password' }),
}))

import { preprocessExecution } from '@/lib/execution/preprocessing'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { GET, POST } from '@/app/api/chat/[identifier]/route'

describe('Chat Identifier API Route', () => {
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
    vi.clearAllMocks()

    mockAddCorsHeaders.mockImplementation((response: Response) => response)
    mockValidateChatAuth.mockResolvedValue({ authorized: true })
    mockValidateAuthToken.mockReturnValue(false)
    mockCreateErrorResponse.mockImplementation((message: string, status: number, code?: string) => {
      return new Response(
        JSON.stringify({
          error: code || 'Error',
          message,
        }),
        { status }
      )
    })
    mockCreateSuccessResponse.mockImplementation((data: unknown) => {
      return new Response(JSON.stringify(data), { status: 200 })
    })

    mockDbSelect.mockImplementation((fields: Record<string, unknown>) => {
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET endpoint', () => {
    it('should return chat info for a valid identifier', async () => {
      const req = createMockNextRequest('GET')
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('id', 'chat-id')
      expect(data).toHaveProperty('title', 'Test Chat')
      expect(data).toHaveProperty('description', 'Test chat description')
      expect(data).toHaveProperty('customizations')
      expect(data.customizations).toHaveProperty('welcomeMessage', 'Welcome to the test chat')
    })

    it('should return 404 for non-existent identifier', async () => {
      mockDbSelect.mockImplementation(() => {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue([]),
            }),
          }),
        }
      })

      const req = createMockNextRequest('GET')
      const params = Promise.resolve({ identifier: 'nonexistent' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Chat not found')
    })

    it('should return 403 for inactive chat', async () => {
      mockDbSelect.mockImplementation(() => {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue([
                {
                  id: 'chat-id',
                  isActive: false,
                  authType: 'public',
                },
              ]),
            }),
          }),
        }
      })

      const req = createMockNextRequest('GET')
      const params = Promise.resolve({ identifier: 'inactive-chat' })

      const response = await GET(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'This chat is currently unavailable')
    })

    it('should return 401 when authentication is required', async () => {
      mockValidateChatAuth.mockResolvedValueOnce({
        authorized: false,
        error: 'auth_required_password',
      })

      const req = createMockNextRequest('GET')
      const params = Promise.resolve({ identifier: 'password-protected-chat' })

      const response = await GET(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'auth_required_password')
    })
  })

  describe('POST endpoint', () => {
    it('should handle authentication requests without input', async () => {
      const req = createMockNextRequest('POST', { password: 'test-password' })
      const params = Promise.resolve({ identifier: 'password-protected-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('authenticated', true)

      expect(mockSetChatAuthCookie).toHaveBeenCalled()
    })

    it('should return 400 for requests without input', async () => {
      const req = createMockNextRequest('POST', {})
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'No input provided')
    })

    it('should return 401 for unauthorized access', async () => {
      mockValidateChatAuth.mockResolvedValueOnce({
        authorized: false,
        error: 'Authentication required',
      })

      const req = createMockNextRequest('POST', { input: 'Hello' })
      const params = Promise.resolve({ identifier: 'protected-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(401)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Authentication required')
    })

    it('should return 503 when workflow is not available', async () => {
      vi.mocked(preprocessExecution).mockResolvedValueOnce({
        success: false,
        error: {
          message: 'Workflow is not deployed',
          statusCode: 403,
          logCreated: false,
        },
      })

      const req = createMockNextRequest('POST', { input: 'Hello' })
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(403)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Workflow is not deployed')
    })

    it('should return streaming response for valid chat messages', async () => {
      const req = createMockNextRequest('POST', {
        input: 'Hello world',
        conversationId: 'conv-123',
      })
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/event-stream')
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
      expect(response.headers.get('Connection')).toBe('keep-alive')

      expect(createStreamingResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: expect.objectContaining({
            id: 'workflow-id',
            userId: 'user-id',
          }),
          input: expect.objectContaining({
            input: 'Hello world',
            conversationId: 'conv-123',
          }),
          streamConfig: expect.objectContaining({
            isSecureMode: true,
            workflowTriggerType: 'chat',
          }),
        })
      )
    }, 10000)

    it('should handle streaming response body correctly', async () => {
      const req = createMockNextRequest('POST', { input: 'Hello world' })
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)
      expect(response.body).toBeInstanceOf(ReadableStream)

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
      vi.mocked(createStreamingResponse).mockImplementationOnce(async () => {
        throw new Error('Execution failed')
      })

      const req = createMockNextRequest('POST', { input: 'Trigger error' })
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(500)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Execution failed')
    })

    it('should handle invalid JSON in request body', async () => {
      const req = {
        method: 'POST',
        headers: new Headers(),
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      } as any

      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(400)

      const data = await response.json()
      expect(data).toHaveProperty('error')
      expect(data).toHaveProperty('message', 'Invalid request body')
    })

    it('should pass conversationId to streaming execution when provided', async () => {
      const req = createMockNextRequest('POST', {
        input: 'Hello world',
        conversationId: 'test-conversation-123',
      })
      const params = Promise.resolve({ identifier: 'test-chat' })

      await POST(req, { params })

      expect(createStreamingResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            input: 'Hello world',
            conversationId: 'test-conversation-123',
          }),
        })
      )
    })

    it('should handle missing conversationId gracefully', async () => {
      const req = createMockNextRequest('POST', { input: 'Hello world' })
      const params = Promise.resolve({ identifier: 'test-chat' })

      await POST(req, { params })

      expect(createStreamingResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            input: 'Hello world',
          }),
        })
      )
    })
  })
})
