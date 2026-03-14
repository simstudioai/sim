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

vi.mock('@/lib/copilot/orchestrator/tool-executor', () => ({
  executeToolServerSide,
  markToolComplete,
  isToolAvailableOnSimSide,
}))

import { sseHandlers } from '@/lib/copilot/orchestrator/sse/handlers'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/orchestrator/types'

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
    context = {
      chatId: undefined,
      messageId: 'msg-1',
      accumulatedContent: '',
      contentBlocks: [],
      toolCalls: new Map(),
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
})
