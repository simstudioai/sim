/**
 * @vitest-environment node
 */

import {
  environmentUtilsMockFns,
  resetEnvFlagsMock,
  resetEnvironmentUtilsMock,
  setEnvFlags,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'

const mockGetEffectiveDecryptedEnv = environmentUtilsMockFns.mockGetEffectiveDecryptedEnv

afterAll(resetEnvironmentUtilsMock)

const {
  mockCreateRunSegment,
  mockForceFailHungToolCall,
  mockGetMothershipBaseURL,
  mockGetMothershipSourceEnvHeaders,
  mockPrepareExecutionContext,
  mockRunStreamLoop,
  mockPendingToolWaitBudgetMs,
  mockGetAutoAllowedTools,
  mockUpdateRunStatus,
  mockEnv,
} = vi.hoisted(() => ({
  mockCreateRunSegment: vi.fn(),
  mockForceFailHungToolCall: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
  mockGetMothershipSourceEnvHeaders: vi.fn(),
  mockPrepareExecutionContext: vi.fn(),
  mockRunStreamLoop: vi.fn(),
  mockPendingToolWaitBudgetMs: vi.fn(() => 60_000),
  mockGetAutoAllowedTools: vi.fn(async () => new Set<string>()),
  mockUpdateRunStatus: vi.fn(),
  mockEnv: {
    COPILOT_API_KEY: undefined as string | undefined,
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

  const STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE =
    'The assistant stopped before finishing this turn. The work it already completed has been saved — send a message to continue from there.'

  class StreamEndedWithoutTerminalError extends Error {
    path: string

    constructor(path: string) {
      super(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
      this.name = 'StreamEndedWithoutTerminalError'
      this.path = path
    }
  }

  return {
    BillingLimitError,
    CopilotBackendError,
    STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE,
    StreamEndedWithoutTerminalError,
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
}))

vi.mock('@/lib/copilot/persistence/tool-permission/auto-allow', () => ({
  getAutoAllowedTools: mockGetAutoAllowedTools,
  addAutoAllowedTool: vi.fn(),
  addChatAutoAllowedTool: vi.fn(),
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
  pendingToolWaitBudgetMs: mockPendingToolWaitBudgetMs,
}))

import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1ToolOutcome,
} from '@/lib/copilot/generated/mothership-stream-v1'
import {
  CopilotBackendError,
  STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE,
  StreamEndedWithoutTerminalError,
} from '@/lib/copilot/request/go/stream'
import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'

afterAll(resetEnvFlagsMock)

describe('runCopilotLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.COPILOT_API_KEY = undefined
    setEnvFlags({
      isHosted: false,
      isCopilotBillingAttributionV1Enabled: false,
      isCopilotToolPermissionsEnabled: false,
    })
    mockGetAutoAllowedTools.mockResolvedValue(new Set<string>())
    mockGetMothershipBaseURL.mockResolvedValue('http://mothership.test')
    mockGetMothershipSourceEnvHeaders.mockReturnValue({})
  })

  describe('tool permission feature flag', () => {
    const runMothershipTurn = () =>
      runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-flag' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          executionId: 'exec-1',
          runId: 'run-1',
          goRoute: '/api/mothership',
          executionContext: {
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            chatId: 'chat-1',
            decryptedEnvVars: {},
          },
        }
      )

    it('stays entirely inert while the flag is off', async () => {
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(captured?.toolPermissions.enabled).toBe(false)
      // Never even reads the preference tables when disabled.
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })

    it('arms the gate and loads the allow list once the flag is on', async () => {
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      mockGetAutoAllowedTools.mockResolvedValue(new Set(['terminal_run']))
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runMothershipTurn()

      expect(captured?.toolPermissions.enabled).toBe(true)
      expect(captured?.toolPermissions.autoAllowed.has('terminal_run')).toBe(true)
      expect(mockGetAutoAllowedTools).toHaveBeenCalledWith('user-1', 'chat-1')
    })

    it('stays off for the workflow-scoped copilot even with the flag on', async () => {
      // That panel has no permission card, so gating there would hang the turn
      // on a prompt nothing draws.
      setEnvFlags({ isCopilotToolPermissionsEnabled: true })
      let captured: StreamingContext | undefined
      mockRunStreamLoop.mockImplementation(async (_u, _o, context: StreamingContext) => {
        captured = context
      })

      await runCopilotLifecycle(
        { message: 'hello', messageId: 'stream-flag-2' },
        {
          userId: 'user-1',
          workspaceId: 'ws-1',
          chatId: 'chat-1',
          goRoute: '/api/copilot',
          executionContext: {
            userId: 'user-1',
            workflowId: 'wf-1',
            workspaceId: 'ws-1',
            chatId: 'chat-1',
            decryptedEnvVars: {},
          },
        }
      )

      expect(captured?.toolPermissions.enabled).toBe(false)
      expect(mockGetAutoAllowedTools).not.toHaveBeenCalled()
    })
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
    setEnvFlags({ isHosted: true })
    setEnvFlags({ isCopilotBillingAttributionV1Enabled: true })
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
    setEnvFlags({ isHosted: true })
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
    setEnvFlags({ isHosted: true })
    setEnvFlags({ isCopilotBillingAttributionV1Enabled: true })
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

    // 2) First resume leg is refused before the backend takes it: it records an
    //    error AND throws a retryable 5xx, which releases the claim in Go.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.errors.push('Copilot backend error (503): service unavailable')
        throw new CopilotBackendError('Copilot backend error (503): service unavailable', {
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

  it('does not promise Go a transparent stream-error retry it will not perform', async () => {
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
          context.errors.push('Copilot backend error (503): service unavailable')
          throw new CopilotBackendError('Copilot backend error (503): service unavailable', {
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

    // Initial + 3 resume attempts: a 5xx is still transient, so the bounded
    // retry budget is unchanged.
    expect(mockRunStreamLoop).toHaveBeenCalledTimes(4)
    // No leg claims a transparent retry. The flag made Go swallow the error tag
    // that explains the failure, and a stream error is never retried now.
    for (const body of bodies) {
      expect(body.willRetryOnStreamError).toBeUndefined()
    }
  })

  it('does not retry a resume leg the backend already claimed and ended early', async () => {
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

    // The resume leg is answered with 200 and then ends without a terminal
    // event — the backend has claimed the checkpoint and reported its outcome,
    // so re-posting it would only reproduce and re-bill the same failure.
    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'Moved the files and updated the workflow.'
        context.errors.push(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
        throw new StreamEndedWithoutTerminalError('/api/tools/resume')
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

    expect(mockRunStreamLoop).toHaveBeenCalledTimes(2)
    expect(result.success).toBe(false)
    expect(result.cancelled).toBe(false)
    expect(result.error).toBe(STREAM_ENDED_WITHOUT_TERMINAL_MESSAGE)
    // Everything that streamed before the leg died is still the user's answer.
    expect(result.content).toBe('Moved the files and updated the workflow.')
  })

  it('resolves the turn normally when the backend completes it after an in-band failure', async () => {
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
        context.toolCalls.set('tool-1', {
          id: 'tool-1',
          name: 'read',
          status: MothershipStreamV1ToolOutcome.success,
          result: { success: true, output: { content: 'file contents' } },
        })
        context.errors.push('Subagent build failed: workflow validation error')
        context.awaitingAsyncContinuation = {
          checkpointId: 'ckpt-1',
          pendingToolCallIds: ['tool-1'],
        }
      }
    )

    mockRunStreamLoop.mockImplementationOnce(
      async (
        _fetchUrl: string,
        _fetchOptions: RequestInit,
        context: StreamingContext
      ): Promise<void> => {
        context.accumulatedContent = 'The build step failed; here is what I changed anyway.'
        context.completionStatus = MothershipStreamV1CompletionStatus.complete
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

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        content: 'The build step failed; here is what I changed anyway.',
        errors: undefined,
      })
    )
  })

  it('keeps the request failed when the backend terminates the turn as an error', async () => {
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
        context.errors.push('The provider is overloaded')
        context.completionStatus = MothershipStreamV1CompletionStatus.error
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

    expect(result.success).toBe(false)
    expect(result.errors).toEqual(['The provider is overloaded'])
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
