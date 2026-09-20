import { describe, expect, it } from 'vitest'
import { getChatCompletionConversationUsage } from '@/providers/openai-compat/conversation-usage'

describe('Chat Completions checkpoint usage', () => {
  it.each([{ prompt_tokens_details: { cached_tokens: 30 } }, { prompt_cache_hit_tokens: 30 }])(
    'separates cached input without changing the prompt total',
    (cache) => {
      expect(
        getChatCompletionConversationUsage({ prompt_tokens: 100, completion_tokens: 20, ...cache })
      ).toEqual({ input: 70, output: 20, cacheRead: 30 })
    }
  )

  it('does not invent usage when the provider omitted it', () => {
    expect(getChatCompletionConversationUsage(undefined)).toBeUndefined()
  })
})
