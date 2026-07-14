/**
 * OpenAI-compat stream fixtures (Step 9) — capability-honest reasoning deltas.
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
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
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
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  },
] as const

export const openaiCompatTextOnlyChunks = [
  {
    choices: [{ delta: { content: 'Hello' } }],
  },
  {
    choices: [{ delta: { content: ' world' } }],
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
