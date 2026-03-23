/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  prepareExecutionContext,
  getEffectiveDecryptedEnv,
  runStreamLoop,
  claimCompletedAsyncToolCall,
  getAsyncToolCalls,
  markAsyncToolResumed,
  updateRunStatus,
} = vi.hoisted(() => ({
  prepareExecutionContext: vi.fn(),
  getEffectiveDecryptedEnv: vi.fn(),
  runStreamLoop: vi.fn(),
  claimCompletedAsyncToolCall: vi.fn(),
  getAsyncToolCalls: vi.fn(),
  markAsyncToolResumed: vi.fn(),
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
  getAsyncToolCalls,
  markAsyncToolResumed,
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
    getAsyncToolCalls.mockResolvedValue([
      {
        toolCallId: 'tool-1',
        toolName: 'read',
        status: 'completed',
        result: { ok: true },
        error: null,
      },
    ])
    markAsyncToolResumed.mockResolvedValue(null)
    updateRunStatus.mockResolvedValue(null)
  })

  it('builds resumed tool payloads with success=true for claimed completed rows', async () => {
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
    expect(markAsyncToolResumed).toHaveBeenCalledWith('tool-1')
  })

  it('marks claimed tool calls resumed even when the resumed stream later records errors', async () => {
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
    expect(markAsyncToolResumed).toHaveBeenCalledWith('tool-1')
  })
})
