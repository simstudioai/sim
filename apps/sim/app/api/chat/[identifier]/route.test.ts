/**
 * Tests for chat identifier API route
 *
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  encryptionMock,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  loggingSessionMock,
  loggingSessionMockFns,
  workflowsApiUtilsMock,
  workflowsApiUtilsMockFns,
} from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  const parsedUrl = new URL(url)

  return {
    method,
    headers: headersObj,
    nextUrl: parsedUrl,
    signal: AbortSignal.timeout(60_000),
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
  mockValidateChatAuth,
  mockSetChatAuthCookie,
  mockProcessChatFiles,
  mockEnforceIpRateLimit,
  mockEnforceResourceRateLimit,
} = vi.hoisted(() => ({
  mockValidateChatAuth: vi.fn().mockResolvedValue({ authorized: true }),
  mockSetChatAuthCookie: vi.fn(),
  mockProcessChatFiles: vi.fn(),
  mockEnforceIpRateLimit: vi.fn(),
  mockEnforceResourceRateLimit: vi.fn(),
}))

const mockCreateErrorResponse = workflowsApiUtilsMockFns.mockCreateErrorResponse
const mockCreateSuccessResponse = workflowsApiUtilsMockFns.mockCreateSuccessResponse

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  chat: {},
  workflow: {},
}))

vi.mock('@/app/api/chat/utils', () => ({
  validateChatAuth: mockValidateChatAuth,
  setChatAuthCookie: mockSetChatAuthCookie,
}))

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/uploads', () => ({
  ChatFiles: {
    processChatFiles: mockProcessChatFiles,
  },
}))

vi.mock('@/lib/workflows/streaming/streaming', () => ({
  createStreamingResponse: vi.fn().mockImplementation(async () => createMockStream()),
  agentStreamProtocolResponseHeaders: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: vi.fn().mockResolvedValue({ success: true, output: {} }),
}))

vi.mock('@/lib/core/utils/sse', () => ({
  SSE_HEADERS: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimitWithIndependentBackstop: mockEnforceIpRateLimit,
  enforceResourceRateLimit: mockEnforceResourceRateLimit,
}))

import { RATE_LIMITS } from '@/lib/core/rate-limiter/types'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
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
      includeThinking: false,
      includeToolCalls: null,
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

    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'test-user-id',
      billingAttribution: {
        actorUserId: 'test-user-id',
        workspaceId: 'test-workspace-id',
        billingEntity: { type: 'organization', id: 'test-organization-id' },
        payerSubscription: null,
      },
      workflowRecord: {
        id: 'test-workflow-id',
        userId: 'test-user-id',
        isDeployed: true,
        workspaceId: 'test-workspace-id',
        variables: {},
      },
    })

    mockValidateChatAuth.mockResolvedValue({ authorized: true })
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockEnforceResourceRateLimit.mockResolvedValue(null)
    mockProcessChatFiles.mockResolvedValue([])
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

    dbChainMockFns.select.mockImplementation((fields: Record<string, unknown>) => {
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
      expect(data).toHaveProperty('includeToolCalls', false)
    })

    it('should return 404 for non-existent identifier', async () => {
      dbChainMockFns.select.mockImplementation(() => {
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
      dbChainMockFns.select.mockImplementation(() => {
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
    it('should return chat config on successful authentication', async () => {
      const passwordDeployment = {
        ...mockChatResult[0],
        authType: 'password',
        password: 'encrypted-password',
      }
      dbChainMockFns.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue([passwordDeployment]),
          }),
        }),
      }))
      const req = createMockNextRequest('POST', { password: 'test-password' })
      const params = Promise.resolve({ identifier: 'password-protected-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('id', 'chat-id')
      expect(data).toHaveProperty('title', 'Test Chat')
      expect(data).toHaveProperty('customizations')
      expect(data.customizations).toHaveProperty('welcomeMessage', 'Welcome to the test chat')

      expect(mockSetChatAuthCookie).toHaveBeenCalledWith(expect.anything(), passwordDeployment)
    })

    describe('execution rate limit', () => {
      it.each([
        ['per-IP', mockEnforceIpRateLimit],
        ['per-deployment', mockEnforceResourceRateLimit],
      ])("refuses on the %s bucket before the owner's budget is reserved", async (_, bucket) => {
        bucket.mockResolvedValue(
          NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
        )
        const req = createMockNextRequest('POST', { input: 'drain the wallet' })

        const response = await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })

        expect(response.status).toBe(429)
        expect(preprocessExecution).not.toHaveBeenCalled()
        expect(createStreamingResponse).not.toHaveBeenCalled()
        expect(mockProcessChatFiles).not.toHaveBeenCalled()
      })

      it('debits buckets keyed on the deployment, not the workflow', async () => {
        const req = createMockNextRequest('POST', { input: 'hello' })

        await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })

        expect(mockEnforceIpRateLimit).toHaveBeenCalledWith(
          'chat-execute',
          req,
          expect.objectContaining({ refillIntervalMs: 60_000 }),
          'chat-id'
        )
        expect(mockEnforceResourceRateLimit).toHaveBeenCalledWith(
          'chat-execute',
          'chat-id',
          expect.objectContaining({ refillIntervalMs: 60_000 })
        )
      })

      it('leaves the deployment bucket untouched when the IP bucket refuses', async () => {
        mockEnforceIpRateLimit.mockResolvedValue(NextResponse.json({}, { status: 429 }))
        const req = createMockNextRequest('POST', { input: 'flood' })

        await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })

        expect(mockEnforceResourceRateLimit).not.toHaveBeenCalled()
      })

      /**
       * The invariant the ceiling exists to hold. A chat execution debits the
       * workspace `sync` counter the owner's API, webhook and scheduled runs
       * share, so a ceiling at or above a plan's own rate never refuses before
       * that shared counter is drained — the availability half of the attack.
       * Asserted against every plan, including free, and on burst as well as
       * sustained rate, since either one reaching the plan bucket first is the
       * same hole.
       */
      it.each(Object.keys(RATE_LIMITS))(
        'stays under the %s plan sync budget it debits',
        async (plan) => {
          const req = createMockNextRequest('POST', { input: 'hello' })

          await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })

          const planBucket = RATE_LIMITS[plan as keyof typeof RATE_LIMITS].sync
          const [, , config] = mockEnforceResourceRateLimit.mock.calls[0]
          expect(config.refillRate).toBeLessThan(planBucket.refillRate)
          expect(config.maxTokens).toBeLessThan(planBucket.maxTokens)
        }
      )

      /** One host must not be able to take the whole deployment's allowance. */
      it('holds the per-IP bucket under the per-deployment one', async () => {
        const req = createMockNextRequest('POST', { input: 'hello' })

        await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })

        const [, , ipConfig] = mockEnforceIpRateLimit.mock.calls[0]
        const [, , deploymentConfig] = mockEnforceResourceRateLimit.mock.calls[0]
        expect(ipConfig.refillRate).toBeLessThan(deploymentConfig.refillRate)
      })

      it('leaves the gate-configuration fetch unmetered', async () => {
        const passwordDeployment = {
          ...mockChatResult[0],
          authType: 'password',
          password: 'encrypted-password',
        }
        dbChainMockFns.select.mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue([passwordDeployment]),
            }),
          }),
        }))
        const req = createMockNextRequest('POST', { password: 'test-password' })

        await POST(req, { params: Promise.resolve({ identifier: 'password-protected-chat' }) })

        expect(mockEnforceIpRateLimit).not.toHaveBeenCalled()
        expect(mockEnforceResourceRateLimit).not.toHaveBeenCalled()
      })
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
          executeFn: expect.any(Function),
          requestSignal: expect.any(AbortSignal),
          requestHeaders: expect.anything(),
          streamConfig: expect.objectContaining({
            isSecureMode: true,
            workflowTriggerType: 'chat',
            includeThinking: false,
            includeToolCalls: false,
          }),
        })
      )
    }, 10000)

    it('projects the internal completion envelope to the public streaming callback', async () => {
      const response = await POST(createMockNextRequest('POST', { input: 'Hello' }), {
        params: Promise.resolve({ identifier: 'test-chat' }),
      })
      expect(response.status).toBe(200)
      const onBlockComplete = vi.fn()
      await vi.mocked(createStreamingResponse).mock.calls[0][0].executeFn({
        onStream: vi.fn(),
        onBlockComplete,
        abortSignal: new AbortController().signal,
      })
      await vi.mocked(executeWorkflow).mock.calls[0][4]?.onBlockComplete?.('block-1', {
        output: { value: 'public output' },
        outputBlockId: 'child:block-1',
        resolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ encryptedValue: 'private-ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
        executionTime: 1,
        executionOrder: 0,
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      })
      expect(onBlockComplete).toHaveBeenCalledExactlyOnceWith(
        'block-1',
        { value: 'public output' },
        'child:block-1'
      )
    })

    it('executes with the email proven by the chat authentication gate', async () => {
      mockValidateChatAuth.mockResolvedValueOnce({
        authorized: true,
        authenticatedEmail: 'person@example.com',
      })
      const req = createMockNextRequest('POST', { input: 'Hello world' })

      const response = await POST(req, {
        params: Promise.resolve({ identifier: 'test-chat' }),
      })
      expect(response.status).toBe(200)

      const streamOptions = vi.mocked(createStreamingResponse).mock.calls[0][0]
      await streamOptions.executeFn({
        onStream: vi.fn(),
        onBlockComplete: vi.fn(),
        abortSignal: new AbortController().signal,
      })

      expect(vi.mocked(executeWorkflow).mock.calls[0][4]).toMatchObject({
        principal: {
          kind: 'system',
          serviceId: 'chat',
          workspaceId: 'test-workspace-id',
          workflowId: 'workflow-id',
          subject: {
            kind: 'authenticated_email',
            email: 'person@example.com',
          },
        },
      })
    }, 10000)

    /**
     * A row predating the column has no tool policy, so it has not opted in.
     * Thinking must not drag tool frames along with it.
     */
    it('reads a null tool policy as off rather than inheriting thinking', async () => {
      const thinkingChatResult = [
        { ...mockChatResult[0], includeThinking: true, includeToolCalls: null },
      ]
      dbChainMockFns.select.mockImplementation((fields: Record<string, unknown>) => {
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
              limit: vi.fn().mockReturnValue(thinkingChatResult),
            }),
          }),
        }
      })

      const req = createMockNextRequest(
        'POST',
        { input: 'Hello world' },
        { 'X-Sim-Stream-Protocol': 'agent-events-v1' }
      )
      const response = await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })
      expect(response.status).toBe(200)

      const options = vi.mocked(createStreamingResponse).mock.calls[0][0]
      expect(options.streamConfig).toMatchObject({
        includeThinking: true,
        includeToolCalls: false,
      })

      await options.executeFn({
        onStream: vi.fn(),
        onBlockComplete: vi.fn(),
        abortSignal: new AbortController().signal,
      })
      const executeOptions = vi.mocked(executeWorkflow).mock.calls[0][4]
      expect(executeOptions).toMatchObject({
        includeThinking: true,
        includeToolCalls: false,
        agentEvents: true,
      })
    }, 10000)

    it('enables agent events for an independent tool-only policy', async () => {
      const toolChatResult = [
        { ...mockChatResult[0], includeThinking: false, includeToolCalls: true },
      ]
      dbChainMockFns.select.mockImplementation((fields: Record<string, unknown>) => {
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
              limit: vi.fn().mockReturnValue(toolChatResult),
            }),
          }),
        }
      })

      const req = createMockNextRequest(
        'POST',
        { input: 'Hello world' },
        { 'X-Sim-Stream-Protocol': 'agent-events-v1' }
      )
      const response = await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })
      expect(response.status).toBe(200)

      const options = vi.mocked(createStreamingResponse).mock.calls[0][0]
      expect(options.streamConfig).toMatchObject({
        includeThinking: false,
        includeToolCalls: true,
      })

      await options.executeFn({
        onStream: vi.fn(),
        onBlockComplete: vi.fn(),
        abortSignal: new AbortController().signal,
      })
      const executeOptions = vi.mocked(executeWorkflow).mock.calls[0][4]
      expect(executeOptions).toMatchObject({
        includeThinking: false,
        includeToolCalls: true,
        agentEvents: true,
      })
    }, 10000)

    /**
     * Chat degrades rather than rejecting: the policy comes from the
     * deployment, so an un-negotiated client made no bad request.
     */
    it('keeps agent events off without the protocol header, even with policy on', async () => {
      const thinkingChatResult = [
        { ...mockChatResult[0], includeThinking: true, includeToolCalls: false },
      ]
      dbChainMockFns.select.mockImplementation((fields: Record<string, unknown>) => {
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
              limit: vi.fn().mockReturnValue(thinkingChatResult),
            }),
          }),
        }
      })

      const req = createMockNextRequest('POST', { input: 'Hello world' })
      const response = await POST(req, { params: Promise.resolve({ identifier: 'test-chat' }) })
      expect(response.status).toBe(200)

      const options = vi.mocked(createStreamingResponse).mock.calls[0][0]
      await options.executeFn({
        onStream: vi.fn(),
        onBlockComplete: vi.fn(),
        abortSignal: new AbortController().signal,
      })
      const executeOptions = vi.mocked(executeWorkflow).mock.calls[0][4]
      expect(executeOptions).toMatchObject({
        includeThinking: true,
        includeToolCalls: false,
        agentEvents: false,
      })
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

    it('does not charge the workspace when chat file preprocessing fails', async () => {
      mockProcessChatFiles.mockRejectedValueOnce(new Error('Upload failed'))

      const req = createMockNextRequest('POST', {
        input: 'Analyze this file',
        files: [
          {
            name: 'document.txt',
            type: 'text/plain',
            size: 4,
            data: 'data',
          },
        ],
      })
      const params = Promise.resolve({ identifier: 'test-chat' })

      const response = await POST(req, { params })

      expect(response.status).toBe(500)
      expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          traceSpans: [],
          skipCost: true,
        })
      )
    })

    it('should handle invalid JSON in request body', async () => {
      const req = {
        method: 'POST',
        headers: new Headers(),
        nextUrl: new URL('http://localhost:3000/api/test'),
        cookies: { get: vi.fn().mockReturnValue(undefined) },
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
          executeFn: expect.any(Function),
          streamConfig: expect.objectContaining({
            workflowTriggerType: 'chat',
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
          executeFn: expect.any(Function),
        })
      )
    })
  })
})
