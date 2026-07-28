/**
 * Anthropic Messages API SSE-style stream events for a single assistant turn that:
 * 1. Streams extended thinking (thinking_delta + signature_delta)
 * 2. Streams answer text (text_delta)
 * 3. Streams a tool_use block (input_json_delta)
 *
 * Shapes mirror Anthropic RawMessageStreamEvent fields used by
 * `createReadableStreamFromAnthropicStream`. The adapter emits thinking_delta +
 * text_delta AgentStreamEvents; tool_use deltas are ignored until the streaming
 * tool loop.
 */

export const anthropicThinkingTextToolStreamEvents = [
  {
    type: 'message_start',
    message: {
      id: 'msg_fixture_thinking_text_tool',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-5',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 42, output_tokens: 0 },
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'I should check the weather before answering. ' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'Calling get_weather for SF.' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'signature_delta',
      signature: 'EpABCkYICBgCKkDfixture-thinking-signature-abc123xyz',
    },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text: 'Let me check the weather in San Francisco.' },
  },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'content_block_start',
    index: 2,
    content_block: {
      type: 'tool_use',
      id: 'toolu_fixture_01Weather',
      name: 'get_weather',
      input: {},
    },
  },
  {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '{"city":' },
  },
  {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '"San Francisco"}' },
  },
  { type: 'content_block_stop', index: 2 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 128 },
  },
  { type: 'message_stop' },
] as const

/**
 * Expected assembled assistant Message.content after draining the stream above.
 * Used for history round-trip tests (thinking block must keep its signature).
 */
export const anthropicThinkingTextToolAssembledContent = [
  {
    type: 'thinking',
    thinking: 'I should check the weather before answering. Calling get_weather for SF.',
    signature: 'EpABCkYICBgCKkDfixture-thinking-signature-abc123xyz',
  },
  {
    type: 'text',
    text: 'Let me check the weather in San Francisco.',
  },
  {
    type: 'tool_use',
    id: 'toolu_fixture_01Weather',
    name: 'get_weather',
    input: { city: 'San Francisco' },
  },
] as const

/** Concatenated thinking text (what traces should store as thinkingContent). */
export const anthropicThinkingTextToolExpectedThinking =
  'I should check the weather before answering. Calling get_weather for SF.'

/** Concatenated answer text (what output.content / live stream should contain today). */
export const anthropicThinkingTextToolExpectedText = 'Let me check the weather in San Francisco.'
