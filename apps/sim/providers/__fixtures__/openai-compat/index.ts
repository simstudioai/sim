/**
 * OpenAI-compat stream fixtures — capability-honest reasoning deltas.
 */
export const openaiCompatReasoningAndTextChunks = [
  {
    choices: [
      {
        delta: {
          reasoning_content: 'I should compute carefully. ',
        },
      },
    ],
  },
  {
    choices: [
      {
        delta: {
          reasoning_content: 'Answer is 4.',
          content: '2+2=',
        },
      },
    ],
  },
  {
    choices: [{ delta: { content: '4' } }],
  },
  // Usage arrives on a trailing chunk with empty choices (stream_options.include_usage).
  {
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
] as const

export const openaiCompatTextOnlyChunks = [
  {
    choices: [{ delta: { content: 'Hello' } }],
  },
  {
    choices: [{ delta: { content: ' world' } }],
  },
  // Usage arrives on a trailing chunk with empty choices (stream_options.include_usage).
  {
    choices: [],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  },
] as const

export const openaiCompatToolCallStartChunks = [
  {
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id: 'call_abc', function: { name: 'http_request', arguments: '' } },
          ],
        },
      },
    ],
  },
  {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"url":' } }],
        },
      },
    ],
  },
] as const
