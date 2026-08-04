import { describe, expect, it } from 'vitest'
import { enrichLastModelSegmentFromChatCompletions } from '@/providers/trace-enrichment'

describe('chat-completions trace enrichment', () => {
  it('separates cached input and accepts provider-normalized token overrides', () => {
    const segments: any[] = [
      { type: 'model', name: 'model', startTime: 1, endTime: 2, duration: 1 },
    ]
    const response = {
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    }

    enrichLastModelSegmentFromChatCompletions(segments, response, undefined, {
      cost: { input: 1, output: 2, total: 3 },
    })
    expect(segments[0].tokens).toEqual({
      input: 60,
      cacheRead: 40,
      output: 20,
      reasoning: 5,
      total: 120,
    })

    enrichLastModelSegmentFromChatCompletions(segments, response, undefined, {
      tokens: { input: 60, cacheRead: 40, output: 25, reasoning: 5, total: 125 },
      cost: { input: 1, output: 2, total: 3 },
    })
    expect(segments[0].tokens).toEqual({
      input: 60,
      cacheRead: 40,
      output: 25,
      reasoning: 5,
      total: 125,
    })
  })
})
