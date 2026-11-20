import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig, ProviderResponse } from '@/providers/types'

vi.mock('openai', () => openaiMock)

vi.mock('groq-sdk', () => ({
  Groq: class {
    chat = { completions: { create: openaiMockFns.mockChatCompletionsCreate } }
  },
}))

vi.mock('@/providers', () => providersMock)

import { deepseekProvider } from '@/providers/deepseek/index'
import { groqProvider } from '@/providers/groq/index'
import { kimiProvider } from '@/providers/kimi/index'
import { zaiProvider } from '@/providers/zai/index'

const mockCreate = openaiMockFns.mockChatCompletionsCreate

/**
 * Each provider reports cache hits as a subset of `prompt_tokens`; billing the whole prompt at the
 * input rate overcharges every cached token. Prices are the catalog's input / cachedInput rates.
 */
describe.each<[string, ProviderConfig, string, Record<string, unknown>, number]>([
  [
    'Z.ai',
    zaiProvider,
    'glm-5.2',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 1.4 + 0.8 * 0.26,
  ],
  [
    'Kimi',
    kimiProvider,
    'kimi-k3',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 3 + 0.8 * 0.3,
  ],
  [
    'DeepSeek',
    deepseekProvider,
    'deepseek-flash',
    { prompt_cache_hit_tokens: 800_000 },
    0.2 * 0.3 + 0.8 * 0.006,
  ],
  [
    'Groq',
    groqProvider,
    'groq/openai/gpt-oss-120b',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 0.15 + 0.8 * 0.075,
  ],
])('%s cache-read billing', (_name, provider, model, cacheFields, expectedInputCost) => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        total_tokens: 1_000_000,
        ...cacheFields,
      },
    })
  })

  it('prices cached prompt tokens at the cached input rate', async () => {
    const response = (await provider.executeRequest({
      model,
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hi' }],
    })) as ProviderResponse

    expect(response.tokens).toMatchObject({ input: 200_000, cacheRead: 800_000 })
    expect(response.cost?.input).toBeCloseTo(expectedInputCost, 8)
  })
})
