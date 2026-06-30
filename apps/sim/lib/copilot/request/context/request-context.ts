import { generateId } from '@sim/utils/id'
import { TraceCollector } from '@/lib/copilot/request/trace'
import type { StreamingContext } from '@/lib/copilot/request/types'

/**
 * Create a fresh StreamingContext.
 */
export function createStreamingContext(overrides?: Partial<StreamingContext>): StreamingContext {
  return {
    chatId: undefined,
    executionId: undefined,
    runId: undefined,
    messageId: generateId(),
    accumulatedContent: '',
    finalAssistantContent: '',
    sawMainToolCall: false,
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    subagentThinkingBlocks: new Map(),
    isInThinkingBlock: false,
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    activeFileIntents: new Map(),
    trace: new TraceCollector(),
    ...overrides,
  }
}
