/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorOptions } from './types'

const {
  prepareExecutionContext,
  getEffectiveDecryptedEnv,
  runStreamLoop,
  claimCompletedAsyncToolCall,
  getAsyncToolCall,
  getAsyncToolCalls,
  markAsyncToolDelivered,
  releaseCompletedAsyncToolClaim,
  updateRunStatus,
} = vi.hoisted(() => ({
  prepareExecutionContext: vi.fn(),
  getEffectiveDecryptedEnv: vi.fn(),
  runStreamLoop: vi.fn(),
  claimCompletedAsyncToolCall: vi.fn(),
  getAsyncToolCall: vi.fn(),
  getAsyncToolCalls: vi.fn(),
  markAsyncToolDelivered: vi.fn(),
  releaseCompletedAsyncToolClaim: vi.fn(),
  updateRunStatus: vi.fn(),
}))

vi.mock('@/lib/copilot/orchestrator/tool-executor', () => ({
  prepareExecutionContext,
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  claimCompletedAsyncToolCall,
  getAsyncToolCall,
  getAsyncToolCalls,
  markAsyncToolDelivered,
  releaseCompletedAsyncToolClaim,
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
  beforeEach(() => {
    vi.clearAllMocks()
    prepareExecutionContext.mockResolvedValue({
      userId: 'user-1',
      workflowId: 'workflow-1',
      chatId: 'chat-1',
    })
    getEffectiveDecryptedEnv.mockResolvedValue({})
    claimCompletedAsyncToolCall.mockResolvedValue({ toolCallId: 'tool-1' })
    getAsyncToolCall.mockResolvedValue({
      toolCallId: 'tool-1',
      toolName: 'read',
      status: 'completed',
      result: { ok: true },
      error: null,
    })
    getAsyncToolCalls.mockResolvedValue([
      {
        toolCallId: 'tool-1',
        toolName: 'read',
        status: 'completed',
        result: { ok: true },
        error: null,
      },
    ])
    markAsyncToolDelivered.mockResolvedValue(null)
    releaseCompletedAsyncToolClaim.mockResolvedValue(null)
    updateRunStatus.mockResolvedValue(null)
  })

  it('builds resume payloads with success=true for claimed completed rows', async () => {
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
          results: [
            {
              callId: 'tool-1',
              name: 'read',
              data: { ok: true },
              success: true,
            },
          ],
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
    expect(markAsyncToolDelivered).toHaveBeenCalledWith('tool-1')
  })

  it('marks claimed tool calls delivered even when the resumed stream later records errors', async () => {
    runStreamLoop
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.awaitingAsyncContinuation = {
          checkpointId: 'checkpoint-1',
          runId: 'run-1',
          pendingToolCallIds: ['tool-1'],
        }
      })
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.errors.push('resume stream failed after handoff')
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
    expect(markAsyncToolDelivered).toHaveBeenCalledWith('tool-1')
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

  it('waits for a local running tool before retrying the claim', async () => {
    const localPendingPromise = Promise.resolve({
      status: 'success',
      data: { ok: true },
    })

    claimCompletedAsyncToolCall
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ toolCallId: 'tool-1' })
    getAsyncToolCall
      .mockResolvedValueOnce({
        toolCallId: 'tool-1',
        toolName: 'read',
        status: 'running',
        result: null,
        error: null,
      })
      .mockResolvedValue({
        toolCallId: 'tool-1',
        toolName: 'read',
        status: 'completed',
        result: { ok: true },
        error: null,
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
        expect(body.results[0]).toEqual({
          callId: 'tool-1',
          name: 'read',
          data: { ok: true },
          success: true,
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
    expect(markAsyncToolDelivered).toHaveBeenCalledWith('tool-1')
  })

  it('releases claimed rows if the resume stream throws before delivery is marked', async () => {
    runStreamLoop
      .mockImplementationOnce(async (_url: string, _opts: RequestInit, context: any) => {
        context.awaitingAsyncContinuation = {
          checkpointId: 'checkpoint-1',
          runId: 'run-1',
          pendingToolCallIds: ['tool-1'],
        }
      })
      .mockImplementationOnce(async () => {
        throw new Error('resume failed')
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
    expect(releaseCompletedAsyncToolClaim).toHaveBeenCalledWith('tool-1', 'run-1')
    expect(markAsyncToolDelivered).not.toHaveBeenCalled()
  })
})
