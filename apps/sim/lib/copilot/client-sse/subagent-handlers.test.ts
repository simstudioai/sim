/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { applySseEvent } from '@/lib/copilot/client-sse/subagent-handlers'
import type { ClientStreamingContext } from '@/lib/copilot/client-sse/types'
import { ClientToolCallState } from '@/lib/copilot/tools/client/tool-display-registry'
import type { CopilotStore, CopilotToolCall } from '@/stores/panel/copilot/types'

type StoreSet = (
  partial: Partial<CopilotStore> | ((state: CopilotStore) => Partial<CopilotStore>)
) => void

function createTestStore(initialToolCalls: Record<string, CopilotToolCall>) {
  const state: Partial<CopilotStore> = {
    messages: [{ id: 'assistant-msg', role: 'assistant', content: '', timestamp: new Date().toISOString() }],
    toolCallsById: { ...initialToolCalls },
    currentChat: null,
    chats: [],
    activeStream: null,
    updatePlanTodoStatus: vi.fn(),
    handleNewChatCreation: vi.fn().mockResolvedValue(undefined),
  }

  const get = () => state as CopilotStore
  const set: StoreSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(get()) : partial
    Object.assign(state, patch)
  }

  return { get, set }
}

function createStreamingContext(): ClientStreamingContext {
  return {
    messageId: 'assistant-msg',
    accumulatedContent: '',
    contentBlocks: [],
    currentTextBlock: null,
    isInThinkingBlock: false,
    currentThinkingBlock: null,
    isInDesignWorkflowBlock: false,
    designWorkflowContent: '',
    pendingContent: '',
    doneEventCount: 0,
    streamComplete: false,
    subAgentContent: {},
    subAgentToolCalls: {},
    subAgentBlocks: {},
    suppressStreamingUpdates: true,
  }
}

describe('client SSE copilot.* stream smoke', () => {
  it('processes main tool call/result events with copilot.* keys', async () => {
    const { get, set } = createTestStore({})
    const context = createStreamingContext()

    await applySseEvent(
      {
        type: 'copilot.tool.call',
        data: { id: 'main-tool-1', name: 'get_user_workflow', state: 'executing', arguments: {} },
      } as any,
      context,
      get,
      set
    )

    await applySseEvent(
      {
        type: 'copilot.tool.result',
        toolCallId: 'main-tool-1',
        success: true,
        result: { ok: true },
        data: {
          id: 'main-tool-1',
          name: 'get_user_workflow',
          phase: 'completed',
          state: 'success',
          success: true,
          result: { ok: true },
        },
      } as any,
      context,
      get,
      set
    )

    expect(get().toolCallsById['main-tool-1']).toBeDefined()
    expect(get().toolCallsById['main-tool-1'].state).toBe(ClientToolCallState.success)
    expect(
      context.contentBlocks.some(
        (block) => block.type === 'tool_call' && block.toolCall?.id === 'main-tool-1'
      )
    ).toBe(true)
  })

  it('processes subagent start/tool/result/end with copilot.* keys', async () => {
    const parentToolCallId = 'parent-edit-tool'
    const { get, set } = createTestStore({
      [parentToolCallId]: {
        id: parentToolCallId,
        name: 'edit',
        state: ClientToolCallState.executing,
      },
    })
    const context = createStreamingContext()

    await applySseEvent(
      {
        type: 'copilot.subagent.started',
        subagent: 'edit',
        data: { tool_call_id: parentToolCallId },
      } as any,
      context,
      get,
      set
    )

    await applySseEvent(
      {
        type: 'copilot.tool.call',
        subagent: 'edit',
        data: {
          id: 'sub-tool-1',
          name: 'workflow_context_get',
          state: 'executing',
          arguments: { includeSchemas: false },
        },
      } as any,
      context,
      get,
      set
    )

    await applySseEvent(
      {
        type: 'copilot.tool.result',
        subagent: 'edit',
        data: {
          id: 'sub-tool-1',
          name: 'workflow_context_get',
          phase: 'completed',
          state: 'success',
          success: true,
          result: { contextPackId: 'pack-1' },
        },
      } as any,
      context,
      get,
      set
    )

    await applySseEvent(
      {
        type: 'copilot.subagent.completed',
        subagent: 'edit',
        data: {},
      } as any,
      context,
      get,
      set
    )

    const parentToolCall = get().toolCallsById[parentToolCallId]
    expect(parentToolCall).toBeDefined()
    expect(parentToolCall.subAgentStreaming).toBe(false)
    expect(parentToolCall.subAgentToolCalls?.length).toBe(1)
    expect(parentToolCall.subAgentToolCalls?.[0]?.id).toBe('sub-tool-1')
    expect(parentToolCall.subAgentToolCalls?.[0]?.state).toBe(ClientToolCallState.success)
  })
})
