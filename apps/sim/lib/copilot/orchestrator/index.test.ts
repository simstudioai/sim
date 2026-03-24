/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorOptions } from './types'

const { prepareExecutionContext, getEffectiveDecryptedEnv, runStreamLoop, updateRunStatus } =
  vi.hoisted(() => ({
    prepareExecutionContext: vi.fn(),
    getEffectiveDecryptedEnv: vi.fn(),
    runStreamLoop: vi.fn(),
    updateRunStatus: vi.fn(),
  }))

vi.mock('@/lib/copilot/orchestrator/tool-executor', () => ({
  prepareExecutionContext,
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  updateRunStatus,
}))

vi.mock('@/lib/copilot/orchestrator/stream/core', async () => {
  const actual = await vi.importActual<typeof import('./stream/core')>('./stream/core')
  return {
    ...actual,
    buildToolCallSummaries: vi.fn(() => []),
    runStreamLoop,
  }
})

import { orchestrateCopilotStream } from './index'

describe('orchestrateCopilotStream async continuation', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchMock)
    prepareExecutionContext.mockResolvedValue({
      userId: 'user-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
    })
    getEffectiveDecryptedEnv.mockResolvedValue({})
    updateRunStatus.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resumes with checkpointId only after Go reports readiness', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        checkpointId: 'checkpoint-1',
        runId: 'run-1',
        resumeState: 'ready',
        ready: true,
        pendingCallIds: ['tool-1'],
        missingCallIds: [],
      }),
    })

    runStreamLoop
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.awaitingAsyncContinuation = {
          checkpointId: 'checkpoint-1',
          runId: 'run-1',
          pendingToolCallIds: ['tool-1'],
        }
      })
      .mockImplementationOnce(async (url: string, opts: RequestInit) => {
        expect(url).toContain('/api/tools/resume')
        const body = JSON.parse(String(opts.body))
        expect(body).toEqual({
          checkpointId: 'checkpoint-1',
        })
      })

    const result = await orchestrateCopilotStream(
      { message: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
      }
    )

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces an explicit error when Go readiness check fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 424,
      json: async () => ({
        error: 'checkpoint not ready',
        code: 'checkpoint_not_ready',
        retryable: true,
        missingCallIds: ['tool-1'],
      }),
    })

    runStreamLoop.mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
      context.awaitingAsyncContinuation = {
        checkpointId: 'checkpoint-1',
        runId: 'run-1',
        pendingToolCallIds: ['tool-1'],
      }
    })

    const result = await orchestrateCopilotStream(
      { message: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
      }
    )

    expect(result.success).toBe(false)
    expect(result.errors).toEqual(['checkpoint not ready'])
    expect(runStreamLoop).toHaveBeenCalledTimes(1)
  })

  it('forwards done events while still marking async pauses on the run', async () => {
    const onEvent = vi.fn()
    const streamOptions: OrchestratorOptions = { onEvent }
    runStreamLoop.mockImplementationOnce(
      async (_url: string, _opts: RequestInit, _context: any, _exec: any, loopOptions: any) => {
        await loopOptions.onEvent({
          type: 'done',
          data: {
            response: {
              async_pause: {
                checkpointId: 'checkpoint-1',
                runId: 'run-1',
              },
            },
          },
        })
      }
    )

    await orchestrateCopilotStream(
      { message: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
        ...streamOptions,
      }
    )

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }))
    expect(updateRunStatus).toHaveBeenCalledWith('run-1', 'paused_waiting_for_tool')
  })

  it('waits for local pending tool promises before asking Go to resume', async () => {
    const localPendingPromise = Promise.resolve({
      status: 'success',
      data: { ok: true },
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        checkpointId: 'checkpoint-1',
        runId: 'run-1',
        resumeState: 'ready',
        ready: true,
        pendingCallIds: ['tool-1'],
        missingCallIds: [],
      }),
    })

    runStreamLoop
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.awaitingAsyncContinuation = {
          checkpointId: 'checkpoint-1',
          runId: 'run-1',
          pendingToolCallIds: ['tool-1'],
        }
        context.pendingToolPromises.set('tool-1', localPendingPromise)
      })
      .mockImplementationOnce(async (url: string, opts: RequestInit) => {
        expect(url).toContain('/api/tools/resume')
        const body = JSON.parse(String(opts.body))
        expect(body).toEqual({
          checkpointId: 'checkpoint-1',
        })
      })

    const result = await orchestrateCopilotStream(
      { message: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
      }
    )

    expect(result.success).toBe(true)
    expect(runStreamLoop).toHaveBeenCalledTimes(2)
  })

  it('retries tool resume after an upstream 502 and succeeds', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        checkpointId: 'checkpoint-1',
        runId: 'run-1',
        resumeState: 'ready',
        ready: true,
        pendingCallIds: ['tool-1'],
        missingCallIds: [],
      }),
    })

    runStreamLoop
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.awaitingAsyncContinuation = {
          checkpointId: 'checkpoint-1',
          runId: 'run-1',
          pendingToolCallIds: ['tool-1'],
        }
      })
      .mockImplementationOnce(async () => {
        throw new Error('Copilot backend error (502): <html><h1>502 Bad Gateway</h1></html>')
      })
      .mockImplementationOnce(async (url: string, opts: RequestInit) => {
        expect(url).toContain('/api/tools/resume')
        const body = JSON.parse(String(opts.body))
        expect(body).toEqual({
          checkpointId: 'checkpoint-1',
        })
      })

    const resultPromise = orchestrateCopilotStream(
      { message: 'hello' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        chatId: 'chat-1',
        executionId: 'exec-1',
        runId: 'run-1',
      }
    )

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.success).toBe(true)
    expect(runStreamLoop).toHaveBeenCalledTimes(3)
  })
})
