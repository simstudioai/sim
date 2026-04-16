import { TraceCollector } from '@/lib/copilot/request/trace'
import type { StreamingContext } from '@/lib/copilot/request/types'
import { generateId } from '@/lib/core/utils/uuid'

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
    contentBlocks: [],
    toolCalls: new Map(),
    pendingToolPromises: new Map(),
    currentThinkingBlock: null,
    currentSubagentThinkingBlock: null,
    isInThinkingBlock: false,
    subAgentParentToolCallId: undefined,
    subAgentParentStack: [],
    subAgentContent: {},
    subAgentToolCalls: {},
    pendingContent: '',
    streamComplete: false,
    wasAborted: false,
    errors: [],
    activeFileIntent: null,
    trace: new TraceCollector(),
    ...overrides,
  }
}
