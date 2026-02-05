/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loggerMock } from '@sim/testing'

vi.mock('@sim/logger', () => loggerMock)

const executeToolServerSide = vi.fn()
const markToolComplete = vi.fn()

vi.mock('@/lib/copilot/orchestrator/tool-executor', () => ({
  executeToolServerSide,
  markToolComplete,
}))

import { sseHandlers } from '@/lib/copilot/orchestrator/sse-handlers'
import type { ExecutionContext, StreamingContext } from '@/lib/copilot/orchestrator/types'

describe('sse-handlers tool lifecycle', () => {
  let context: StreamingContext
  let execContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
    context = {
      chatId: undefined,
      conversationId: undefined,
      messageId: 'msg-1',
      accumulatedContent: '',
      contentBlocks: [],
      toolCalls: new Map(),
      currentThinkingBlock: null,
      isInThinkingBlock: false,
      subAgentParentToolCallId: undefined,
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
        data: { id: 'tool-1', name: 'get_user_workflow', arguments: { workflowId: 'workflow-1' } },
      } as any,
      context,
      execContext,
      { onEvent, interactive: false, timeout: 1000 }
    )

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
      data: { id: 'tool-dup', name: 'get_user_workflow', arguments: { workflowId: 'workflow-1' } },
    }

    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })
    await sseHandlers.tool_call(event as any, context, execContext, { interactive: false })

    expect(executeToolServerSide).toHaveBeenCalledTimes(1)
    expect(markToolComplete).toHaveBeenCalledTimes(1)
  })
})

