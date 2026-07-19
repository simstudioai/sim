/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'

const {
  mockCreateRunSegment,
  mockForceFailHungToolCall,
  mockGetEffectiveDecryptedEnv,
  mockGetMothershipBaseURL,
  mockGetMothershipSourceEnvHeaders,
  mockPrepareExecutionContext,
  mockRunStreamLoop,
  mockToolWatchdogTimeoutMs,
  mockUpdateRunStatus,
  mockEnv,
  mockFlags,
} = vi.hoisted(() => ({
  mockCreateRunSegment: vi.fn(),
  mockForceFailHungToolCall: vi.fn(),
  mockGetEffectiveDecryptedEnv: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
  mockGetMothershipSourceEnvHeaders: vi.fn(),
  mockPrepareExecutionContext: vi.fn(),
  mockRunStreamLoop: vi.fn(),
  mockToolWatchdogTimeoutMs: vi.fn(() => 60_000),
  mockUpdateRunStatus: vi.fn(),
  mockEnv: {
    COPILOT_API_KEY: undefined as string | undefined,
  },
  mockFlags: {
    isHosted: false,
    isCopilotBillingAttributionV1Enabled: false,
  },
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: mockCreateRunSegment,
  updateRunStatus: mockUpdateRunStatus,
}))

vi.mock('@/lib/copilot/request/go/stream', () => {
  class CopilotBackendError extends Error {
    status?: number

    constructor(message: string, options?: { status?: number }) {
      super(message)
      this.name = 'CopilotBackendError'
      this.status = options?.status
    }
  }

  class BillingLimitError extends Error {
    userId: string

    constructor(userId: string) {
      super('Usage limit reached')
      this.name = 'BillingLimitError'
      this.userId = userId
    }
  }

  return {
    BillingLimitError,
    CopilotBackendError,
    runStreamLoop: mockRunStreamLoop,
  }
})

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: mockGetMothershipBaseURL,
  getMothershipSourceEnvHeaders: mockGetMothershipSourceEnvHeaders,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  getEnv: vi.fn((key: string) => (key === 'NEXT_PUBLIC_APP_URL' ? 'http://localhost:3000' : '')),
  isTruthy: vi.fn((value: string | undefined) => value === 'true'),
  isFalsy: vi.fn((value: string | undefined) => value === 'false'),
  envNumber: (val: unknown, fallback: number) => {
    const n = typeof val === 'string' ? Number(val) : (val as number)
    return Number.isFinite(n) ? n : fallback
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isCopilotBillingAttributionV1Enabled() {
    return mockFlags.isCopilotBillingAttributionV1Enabled
  },
  get isHosted() {
    return mockFlags.isHosted
  },
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: mockGetEffectiveDecryptedEnv,
}))

vi.mock('@/lib/copilot/tools/handlers/context', () => ({
  prepareExecutionContext: mockPrepareExecutionContext,
}))

vi.mock('@/lib/copilot/request/tools/billing', () => ({
  handleBillingLimitResponse: vi.fn(),
}))

vi.mock('@/lib/copilot/request/tools/executor', () => ({
  executeToolAndReport: vi.fn(),
  forceFailHungToolCall: mockForceFailHungToolCall,
  toolWatchdogTimeoutMs: mockToolWatchdogTimeoutMs,
}))

import { MothershipStreamV1ToolOutcome } from '@/lib/copilot/generated/mothership-stream-v1'
import { CopilotBackendError } from '@/lib/copilot/request/go/stream'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'

describe('runCopilotLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.COPILOT_API_KEY = undefined
    mockFlags.isHosted = false
    mockFlags.isCopilotBillingAttributionV1Enabled = false
    mockGetMothershipBaseURL.mockResolvedValue('http://mothership.test')
    mockGetMothershipSourceEnvHeaders.mockReturnValue({})
  })

  it('runs cancelled completion persistence when a stream throws after abort', async () => {
    const abortController = new AbortController()
    abortController.abort('stop')
    const onComplete = vi.fn()
    const onError = vi.fn()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'partial answer'
        context.contentBlocks.push({
          type: 'text',
          content: 'partial answer',
          timestamp: 1,
        })
        throw new Error('publisher closed after stop')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        abortSignal: abortController.signal,
        executionContext,
        onComplete,
        onError,
      }
    )

    expect(onError).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        chatId: 'chat-1',
        requestId: undefined,
        error: 'publisher closed after stop',
        contentBlocks: [
          expect.objectContaining({
            type: 'text',
            content: 'partial answer',
          }),
        ],
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        chatId: 'chat-1',
        error: 'publisher closed after stop',
      })
    )
  })

  it('returns the cancelled result when cancelled completion persistence fails', async () => {
    const abortController = new AbortController()
    abortController.abort('stop')
    const onComplete = vi.fn().mockRejectedValue(new Error('db unavailable'))
    const onError = vi.fn()
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'partial answer'
        throw new Error('publisher closed after stop')
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        abortSignal: abortController.signal,
        executionContext,
        onComplete,
        onError,
      }
    )

    expect(onError).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        cancelled: true,
        content: 'partial answer',
        error: 'publisher closed after stop',
      })
    )
  })

  it('uses the final post-tool assistant content for headless results', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'I will check that.Final answer only.'
        context.finalAssistantContent = 'Final answer only.'
        context.sawMainToolCall = true
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
        interactive: false,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        content: 'Final answer only.',
      })
    )
  })

  it('does not fall back to pre-tool narration when headless final content is empty', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'I will check that.'
        context.finalAssistantContent = ''
        context.sawMainToolCall = true
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
        interactive: false,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        content: '',
      })
    )
  })

  it('propagates payload userPermission into the generated execution context', async () => {
    let capturedExecContext: ExecutionContext | undefined
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        _context: StreamingContext,
        execContext: ExecutionContext
      ): Promise<void> => {
        capturedExecContext = execContext
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1', userPermission: 'write' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }
    )

    expect(capturedExecContext).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        userPermission: 'write',
      })
    )
  })

  it('uses one server billing identity and immutable attribution on initial and resume legs', async () => {
    const billingAttribution = {
      actorUserId: 'user-1',
      workspaceId: 'ws-1',
      billedAccountUserId: 'owner-1',
      organizationId: 'org-1',
      billingEntity: { type: 'organization' as const, id: 'org-1' },
      billingPeriod: {
        start: '2026-07-01T00:00:00.000Z',
        end: '2026-08-01T00:00:00.000Z',
      },
      payerSubscription: null,
    }
    mockFlags.isHosted = true
    mockFlags.isCopilotBillingAttributionV1Enabled = true
    mockEnv.COPILOT_API_KEY = 'sim-agent-key'
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )
    mockRunStreamLoop.mockResolvedValueOnce(undefined)

    await runCopilotLifecycle(
      {
        message: 'hello',
        messageId: 'message-1',
        billingRequestId: 'caller-controlled',
      },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
        runId: 'run-1',
        simRequestId: 'request-1',
        billingAttribution,
      }
    )

    const firstHeaders = mockRunStreamLoop.mock.calls[0]?.[1].headers as Record<string, string>
    const billingRequestId = firstHeaders['x-sim-billing-request-id']
    expect(billingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(billingRequestId).not.toBe('caller-controlled')

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    for (const call of mockRunStreamLoop.mock.calls) {
      const headers = call[1].headers as Record<string, string>
      expect(headers).toMatchObject({
        'x-api-key': 'sim-agent-key',
        'x-sim-billing-protocol': 'attribution-v1',
        'x-sim-billing-request-id': billingRequestId,
      })
      expect(JSON.parse(decodeURIComponent(headers['x-sim-billing-attribution']))).toEqual(
        billingAttribution
      )
    }
  })

  it('runs legacy-v0 during Sim-first deployment without guessed billing aliases', async () => {
    mockFlags.isHosted = true
    mockEnv.COPILOT_API_KEY = 'sim-agent-key'
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'message-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'execution-1',
        runId: 'run-1',
        simRequestId: 'request-1',
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'ws-1',
          billedAccountUserId: 'owner-1',
          organizationId: null,
          billingEntity: { type: 'user', id: 'owner-1' },
          billingPeriod: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          },
          payerSubscription: null,
        },
      }
    )

    const headers = mockRunStreamLoop.mock.calls[0]?.[1].headers as Record<string, string>
    expect(headers['x-sim-billing-protocol']).toBe('legacy-v0')
    expect(headers['x-sim-billing-request-id']).toBeUndefined()
    expect(headers['x-sim-billing-attribution']).toBeUndefined()
  })

  it('runs modern hosted work without legacy compatibility storage', async () => {
    mockFlags.isHosted = true
    mockFlags.isCopilotBillingAttributionV1Enabled = true
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'message-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'ws-1',
          billedAccountUserId: 'owner-1',
          organizationId: null,
          billingEntity: { type: 'user', id: 'owner-1' },
          billingPeriod: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          },
          payerSubscription: null,
        },
      }
    )

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(1)
  })

  it('does not emit trusted billing headers for a non-hosted lifecycle', async () => {
    mockEnv.COPILOT_API_KEY = 'user-or-self-hosted-key'
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'message-1', billingRequestId: 'caller-controlled' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'ws-1',
          billedAccountUserId: 'owner-1',
          organizationId: null,
          billingEntity: { type: 'user', id: 'owner-1' },
          billingPeriod: {
            start: '2026-07-01T00:00:00.000Z',
            end: '2026-08-01T00:00:00.000Z',
          },
          payerSubscription: null,
        },
      }
    )

    const headers = mockRunStreamLoop.mock.calls[0]?.[1].headers as Record<string, string>
    expect(headers['x-sim-billing-protocol']).toBeUndefined()
    expect(headers['x-sim-billing-request-id']).toBeUndefined()
    expect(headers['x-sim-billing-attribution']).toBeUndefined()
  })

  it('normalizes the initial request body with workspaceId from lifecycle options', async () => {
    let requestBody: Record<string, unknown> | undefined
    mockGetEffectiveDecryptedEnv.mockResolvedValueOnce({})
    mockRunStreamLoop.mockImplementationOnce(
      async (_fetchUrl: string, fetchOptions: RequestInit): Promise<void> => {
        requestBody = JSON.parse(String(fetchOptions.body))
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      }
    )

    expect(requestBody).toEqual(
      expect.objectContaining({
        workspaceId: 'ws-1',
      })
    )
  })

  it('uses the lifecycle workspaceId for async tool resume requests', async () => {
    const requestBodies: Record<string, unknown>[] = []
    const fetchUrls: string[] = []
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    mockRunStreamLoop.mockImplementationOnce(
      async (
        fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        fetchUrls.push(fetchUrl)
        requestBodies.push(JSON.parse(String(fetchOptions.body)))
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )
    mockRunStreamLoop.mockImplementationOnce(
      async (fetchUrl: string, fetchOptions: RequestInit): Promise<void> => {
        fetchUrls.push(fetchUrl)
        requestBodies.push(JSON.parse(String(fetchOptions.body)))
      }
    )

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
    expect(requestBodies[1]).toEqual(
      expect.objectContaining({
        checkpointId: 'ckpt-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
      })
    )
  })

  it('finalizes as success when a resume fails with a retryable error then the retry succeeds', async () => {
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    // 1) Initial stream pauses on an async tool checkpoint with a resolved
    //    tool result, so the lifecycle transitions into a resume leg.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    // 2) First resume leg dies mid-stream like a transient provider error:
    //    it records an error AND throws a retryable 5xx.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.errors.push(
          'Copilot backend stream ended before a terminal event on /api/tools/resume'
        )
        throw new CopilotBackendError('backend stream ended before a terminal event', {
          status: 503,
        })
      }
    )

    // 3) Retry of the same resume leg succeeds cleanly.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'Recovered final answer.'
        context.finalAssistantContent = 'Recovered final answer.'
      }
    )

    const result = await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    // Three legs ran (initial + failed resume + retried resume), and the
    // recovered retry must NOT inherit the failed attempt's error.
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(3)
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        errors: undefined,
      })
    )
  })

  it('marks resume legs willRetryOnStreamError except the final attempt', async () => {
    const bodies: Record<string, unknown>[] = []
    const executionContext: ExecutionContext = {
      userId: 'user-1',
      workflowId: '',
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      decryptedEnvVars: {},
    }

    // Initial leg pauses on a resolved async tool checkpoint → enters resume.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        bodies.push(JSON.parse(String(fetchOptions.body)))
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    // Three resume attempts, all failing with a retryable 5xx so the loop
    // exhausts MAX_RESUME_ATTEMPTS (= 3) and gives up.
    for (let i = 0; i < 3; i++) {
      mockRunStreamLoop.mockImplementationOnce(
        async (
          _fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.errors.push('Copilot backend stream ended before a terminal event')
          throw new CopilotBackendError('backend stream ended before a terminal event', {
            status: 503,
          })
        }
      )
    }

    await runCopilotLifecycle(
      { message: 'hello', messageId: 'stream-1' },
      {
        userId: 'user-1',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        executionContext,
      }
    )

    // Initial + 3 resume attempts.
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(4)
    // Initial leg is never retried by this loop → no flag.
    expect(bodies[0].willRetryOnStreamError).toBeUndefined()
    // Resume attempts 0 and 1 will be retried on a stream error → flagged.
    expect(bodies[1].willRetryOnStreamError).toBe(true)
    expect(bodies[2].willRetryOnStreamError).toBe(true)
    // Final attempt (2) is terminal → not flagged, so Go bills + surfaces it.
    expect(bodies[3].willRetryOnStreamError).toBeUndefined()
  })

  it('force-fails a hung tool promise and resumes with an error result instead of wedging', async () => {
    vi.useFakeTimers()
    try {
      const fetchUrls: string[] = []
      const bodies: Record<string, unknown>[] = []
      const executionContext: ExecutionContext = {
        userId: 'user-1',
        workflowId: '',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
        decryptedEnvVars: {},
      }

      // Mirror the real helper: settle the tool call into a terminal error
      // state so the resume loop can serialize an error result for it.
      mockForceFailHungToolCall.mockImplementation(
        async (toolCallId: string, context: StreamingContext, message: string) => {
          const tool = context.toolCalls.get(toolCallId)
          if (!tool) return
          tool.status = MothershipStreamV1ToolOutcome.error
          tool.endTime = Date.now()
          tool.result = { success: false }
          tool.error = message
        }
      )

      // Initial leg checkpoints on an async tool whose promise NEVER settles —
      // the exact shape of the prod incident (claimed, marked running, hung).
      mockRunStreamLoop.mockImplementationOnce(
        async (
          fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          fetchUrls.push(fetchUrl)
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.toolCalls.set('tool-hung', {
            id: 'tool-hung',
            name: 'read',
            status: 'executing',
          })
          context.pendingToolPromises.set('tool-hung', new Promise(() => {}))
          context.awaitingAsyncContinuation = {
            checkpointId: 'ckpt-1',
            pendingToolCallIds: ['tool-hung'],
          }
        }
      )

      // Resume leg completes normally with the error result delivered.
      mockRunStreamLoop.mockImplementationOnce(
        async (
          fetchUrl: string,
          fetchOptions: RequestInit,
          context: StreamingContext
        ): Promise<void> => {
          fetchUrls.push(fetchUrl)
          bodies.push(JSON.parse(String(fetchOptions.body)))
          context.accumulatedContent = 'The file read failed, but here is what I know.'
        }
      )

      const lifecycle = runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-1' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          executionContext,
        }
      )

      // Wait budget = watchdog (60s, mocked) + resume grace (30s). Advance past it.
      await vi.advanceTimersByTimeAsync(91_000)
      const result = await lifecycle

      expect(mockForceFailHungToolCall).toHaveBeenCalledWith(
        'tool-hung',
        expect.anything(),
        expect.stringContaining('hung')
      )
      expect(fetchUrls[1]).toBe('http://mothership.test/api/tools/resume')
      expect(bodies[1].results).toEqual([
        expect.objectContaining({
          callId: 'tool-hung',
          name: 'read',
          success: false,
          data: { error: expect.stringContaining('hung') },
        }),
      ])
      expect(result.success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
