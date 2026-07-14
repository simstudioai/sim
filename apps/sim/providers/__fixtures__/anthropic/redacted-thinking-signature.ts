/**
 * Anthropic stream + assembled message covering redacted_thinking blocks.
 *
 * When Anthropic redacts thinking, the stream emits a redacted_thinking content
 * block (opaque `data`) instead of thinking_delta text. Multi-turn tool loops
 * must round-trip that block (and any adjacent signed thinking blocks) back
 * into subsequent Messages API requests unchanged.
 */

export const anthropicRedactedThinkingStreamEvents = [
  {
    type: 'message_start',
    message: {
      id: 'msg_fixture_redacted_thinking',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-5',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 20, output_tokens: 0 },
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'redacted_thinking',
      data: 'fixture-redacted-thinking-opaque-blob-001',
    },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'thinking',
      thinking: '',
    },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'thinking_delta', thinking: 'Visible follow-up reasoning after redaction.' },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: {
      type: 'signature_delta',
      signature: 'EpABCkYICBgCKkDfixture-visible-thinking-signature-def456',
    },
  },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'text_delta', text: 'Here is the answer after redacted thinking.' },
  },
  { type: 'content_block_stop', index: 2 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 64 },
  },
  { type: 'message_stop' },
] as const

/**
 * Assembled content that must be preserved when appending the assistant turn
 * to Anthropic history (see anthropic/core.ts thinking/redacted_thinking filters).
 */
export const anthropicRedactedThinkingAssembledContent = [
  {
    type: 'redacted_thinking',
    data: 'fixture-redacted-thinking-opaque-blob-001',
  },
  {
    type: 'thinking',
    thinking: 'Visible follow-up reasoning after redaction.',
    signature: 'EpABCkYICBgCKkDfixture-visible-thinking-signature-def456',
  },
  {
    type: 'text',
    text: 'Here is the answer after redacted thinking.',
  },
] as const

/** What enrichLastModelSegmentFromAnthropicResponse maps redacted blocks to today. */
export const anthropicRedactedThinkingExpectedTraceThinking =
  '[redacted]\n\nVisible follow-up reasoning after redaction.'

export const anthropicRedactedThinkingExpectedText =
  'Here is the answer after redacted thinking.'
