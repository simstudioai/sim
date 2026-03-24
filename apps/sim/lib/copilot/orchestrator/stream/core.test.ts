/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildToolCallSummaries } from '@/lib/copilot/orchestrator/stream/core'
import type { StreamingContext } from '@/lib/copilot/orchestrator/types'

function makeContext(): StreamingContext {
  return {
    chatId: undefined,
    requestId: undefined,
    executionId: undefined,
    runId: undefined,
    messageId: 'msg-1',
    accumulatedContent: '',
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    awaitingAsyncContinuation: undefined,
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
}

describe('buildToolCallSummaries', () => {
  it.concurrent('keeps pending tools as pending instead of defaulting to success', () => {
    const context = makeContext()
    context.toolCalls.set('tool-1', {
      id: 'tool-1',
      name: 'download_to_workspace_file',
      status: 'pending',
      startTime: 1,
    })

    const summaries = buildToolCallSummaries(context)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.status).toBe('pending')
  })

  it.concurrent('keeps executing tools as executing when no result exists yet', () => {
    const context = makeContext()
    context.toolCalls.set('tool-2', {
      id: 'tool-2',
      name: 'function_execute',
      status: 'executing',
      startTime: 1,
    })

    const summaries = buildToolCallSummaries(context)

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.status).toBe('executing')
  })
})
