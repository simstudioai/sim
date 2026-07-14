/**
 * Re-exports Anthropic stream fixtures used by agent-stream-events work.
 * Keep fixture data in dedicated modules so adapters can import without pulling tests.
 */
export {
  anthropicThinkingTextToolAssembledContent,
  anthropicThinkingTextToolExpectedText,
  anthropicThinkingTextToolExpectedThinking,
  anthropicThinkingTextToolStreamEvents,
} from '@/providers/__fixtures__/anthropic/thinking-text-tool'
export {
  anthropicRedactedThinkingAssembledContent,
  anthropicRedactedThinkingExpectedText,
  anthropicRedactedThinkingExpectedTraceThinking,
  anthropicRedactedThinkingStreamEvents,
} from '@/providers/__fixtures__/anthropic/redacted-thinking-signature'
