/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/request/types'

const {
  mockCreateRunSegment,
  mockGetEffectiveDecryptedEnv,
  mockGetMothershipBaseURL,
  mockGetMothershipSourceEnvHeaders,
  mockPrepareExecutionContext,
  mockRunStreamLoop,
  mockUpdateRunStatus,
} = vi.hoisted(() => ({
  mockCreateRunSegment: vi.fn(),
  mockGetEffectiveDecryptedEnv: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
  mockGetMothershipSourceEnvHeaders: vi.fn(),
  mockPrepareExecutionContext: vi.fn(),
  mockRunStreamLoop: vi.fn(),
  mockUpdateRunStatus: vi.fn(),
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
  env: {
    COPILOT_API_KEY: undefined,
  },
  getEnv: vi.fn((key: string) => (key === 'NEXT_PUBLIC_APP_URL' ? 'http://localhost:3000' : '')),
  isTruthy: vi.fn((value: string | undefined) => value === 'true'),
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
}))

import { runCopilotLifecycle } from '@/lib/copilot/request/lifecycle/run'

describe('runCopilotLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
