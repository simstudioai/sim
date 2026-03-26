/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

const { executeToolServerSide, markToolComplete, isToolAvailableOnSimSide } = vi.hoisted(() => ({
  executeToolServerSide: vi.fn(),
  markToolComplete: vi.fn(),
  isToolAvailableOnSimSide: vi.fn().mockReturnValue(true),
}))

const { upsertAsyncToolCall } = vi.hoisted(() => ({
  upsertAsyncToolCall: vi.fn(),
}))

vi.mock('@/lib/copilot/orchestrator/tool-executor', () => ({
  executeToolServerSide,
  markToolComplete,
  isToolAvailableOnSimSide,
}))

vi.mock('@/lib/copilot/async-runs/repository', async () => {
  const actual = await vi.importActual<typeof import('@/lib/copilot/async-runs/repository')>(
    '@/lib/copilot/async-runs/repository'
  )
  return {
    ...actual,
    upsertAsyncToolCall,
  }
})

import { sseHandlers } from '@/lib/copilot/orchestrator/sse/handlers'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/orchestrator/types'

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
    upsertAsyncToolCall.mockResolvedValue(null)
    context = {
      chatId: undefined,
      messageId: 'msg-1',
      accumulatedContent: '',
      contentBlocks: [],
      toolCalls: new Map(),
      pendingToolPromises: new Map(),
      currentThinkingBlock: null,
      isInThinkingBlock: false,
      subAgentParentToolCallId: undefined,
      subAgentParentStack: [],
      subAgentContent: {},
      subAgentToolCalls: {},
      pendingContent: '',
      streamComplete: false,
      wasAborted: false,
      errors: [],
    }
    execContext = {
      userId: 'user-1',
      workflowId: 'workflow-1',
    }
  })

  it('executes tool_call and emits tool_result + mark-complete', async () => {
    executeToolServerSide.mockResolvedValueOnce({ success: true, output: { ok: true } })
    markToolComplete.mockResolvedValueOnce(true)
    const onEvent = vi.fn()

    await sseHandlers.tool_call(
      {
        type: 'tool_call',
        data: { id: 'tool-1', name: 'read', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    // tool_call fires execution without awaiting (fire-and-forget for parallel execution),
    // so we flush pending microtasks before asserting
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeToolServerSide).toHaveBeenCalledTimes(1)
    expect(markToolComplete).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'tool-1',
        success: true,
      })
    )

    const updated = context.toolCalls.get('tool-1')
    expect(updated?.status).toBe('success')
    expect(updated?.result?.output).toEqual({ ok: true })
  })

  it('skips duplicate tool_call after result', async () => {
    executeToolServerSide.mockResolvedValueOnce({ success: true, output: { ok: true } })
    markToolComplete.mockResolvedValueOnce(true)

    const event = {
      type: 'tool_call',
      data: { id: 'tool-dup', name: 'read', arguments: { workflowId: 'workflow-1' } },
    }

    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })

    expect(executeToolServerSide).toHaveBeenCalledTimes(1)
    expect(markToolComplete).toHaveBeenCalledTimes(1)
  })

  it('marks an in-flight tool as cancelled when aborted mid-execution', async () => {
    const abortController = new AbortController()
    const userStopController = new AbortController()
    execContext.abortSignal = abortController.signal
    execContext.userStopSignal = userStopController.signal

    executeToolServerSide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, output: { ok: true } }), 0)
        })
    )
    markToolComplete.mockResolvedValue(true)

    await sseHandlers.tool_call(
      {
        type: 'tool_call',
        data: { id: 'tool-cancel', name: 'read', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      {
        interactive: false,
        timeout: 1000,
        abortSignal: abortController.signal,
        userStopSignal: userStopController.signal,
      }
    )

    userStopController.abort()
    abortController.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(markToolComplete).toHaveBeenCalledWith(
      'tool-cancel',
      'read',
      499,
      'Request aborted during tool execution',
      { cancelled: true },
      'msg-1'
    )

    const updated = context.toolCalls.get('tool-cancel')
    expect(updated?.status).toBe('cancelled')
  })

  it('does not replace an in-flight pending promise on duplicate tool_call', async () => {
    let resolveTool: ((value: { success: boolean; output: { ok: boolean } }) => void) | undefined
    executeToolServerSide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTool = resolve
        })
    )
    markToolComplete.mockResolvedValueOnce(true)

    const event = {
      type: 'tool_call',
      data: { id: 'tool-inflight', name: 'read', arguments: { workflowId: 'workflow-1' } },
    }

    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const firstPromise = context.pendingToolPromises.get('tool-inflight')
    expect(firstPromise).toBeDefined()

    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })

    expect(executeToolServerSide).toHaveBeenCalledTimes(1)
    expect(context.pendingToolPromises.get('tool-inflight')).toBe(firstPromise)

    resolveTool?.({ success: true, output: { ok: true } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(context.pendingToolPromises.has('tool-inflight')).toBe(false)
    expect(markToolComplete).toHaveBeenCalledTimes(1)
  })

  it('still executes the tool when async row upsert fails', async () => {
    upsertAsyncToolCall.mockRejectedValueOnce(new Error('db down'))
    executeToolServerSide.mockResolvedValueOnce({ success: true, output: { ok: true } })
    markToolComplete.mockResolvedValueOnce(true)

    await sseHandlers.tool_call(
      {
        type: 'tool_call',
        data: { id: 'tool-upsert-fail', name: 'read', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      { onEvent: vi.fn(), interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeToolServerSide).toHaveBeenCalledTimes(1)
    expect(markToolComplete).toHaveBeenCalledTimes(1)
    expect(context.toolCalls.get('tool-upsert-fail')?.status).toBe('success')
  })

  it('does not execute a tool if a terminal tool_result arrives before local execution starts', async () => {
    let resolveUpsert: ((value: null) => void) | undefined
    upsertAsyncToolCall.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpsert = resolve
        })
    )
    const onEvent = vi.fn()

    await sseHandlers.tool_call(
      {
        type: 'tool_call',
        data: { id: 'tool-race', name: 'read', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool_result(
      {
        type: 'tool_result',
        toolCallId: 'tool-race',
        data: { id: 'tool-race', success: true, result: { ok: true } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    resolveUpsert?.(null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeToolServerSide).not.toHaveBeenCalled()
    expect(markToolComplete).not.toHaveBeenCalled()
    expect(context.toolCalls.get('tool-race')?.status).toBe('success')
    expect(context.toolCalls.get('tool-race')?.result?.output).toEqual({ ok: true })
  })

  it('does not execute a tool if a tool_result arrives before the tool_call event', async () => {
    const onEvent = vi.fn()

    await sseHandlers.tool_result(
      {
        type: 'tool_result',
        toolCallId: 'tool-early-result',
        toolName: 'read',
        data: { id: 'tool-early-result', name: 'read', success: true, result: { ok: true } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await sseHandlers.tool_call(
      {
        type: 'tool_call',
        data: { id: 'tool-early-result', name: 'read', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(executeToolServerSide).not.toHaveBeenCalled()
    expect(markToolComplete).not.toHaveBeenCalled()
    expect(context.toolCalls.get('tool-early-result')?.status).toBe('success')
  })
})
