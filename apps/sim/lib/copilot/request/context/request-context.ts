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
    messageId: crypto.randomUUID(),
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
    trace: new TraceCollector(),
    ...overrides,
  }
}
