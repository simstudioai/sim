import { collectStream } from '@sim/testing/helpers/async'
import { openaiMock, openaiMockFns } from '@sim/testing/mocks/openai.mock'
import { providersMock } from '@sim/testing/mocks/providers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingExecution } from '@/executor/types'
import type { ProviderConfig, ProviderResponse } from '@/providers/types'

vi.mock('openai', () => openaiMock)

vi.mock('groq-sdk', () => ({
  Groq: class {
    chat = { completions: { create: openaiMockFns.mockChatCompletionsCreate } }
  },
}))

vi.mock('@/providers', () => providersMock)

import { deepseekProvider } from '@/providers/deepseek/index'
import { fireworksProvider } from '@/providers/fireworks/index'
import { groqProvider } from '@/providers/groq/index'
import { kimiProvider } from '@/providers/kimi/index'
import { metaProvider } from '@/providers/meta/index'
import { mistralProvider } from '@/providers/mistral/index'
import { sakanaProvider } from '@/providers/sakana/index'
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
  [
    'Meta',
    metaProvider,
    'muse-spark-1.3',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 1.25 + 0.8 * 0.15,
  ],
  [
    'Mistral',
    mistralProvider,
    'mistral-large-4',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 0.7 + 0.8 * 0.07,
  ],
  [
    'Sakana',
    sakanaProvider,
    'fugu-max',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 2 + 0.8 * 0.25,
  ],
  [
    'Fireworks (shared Chat Completions path)',
    fireworksProvider,
    'fireworks/glm-5.3',
    { prompt_tokens_details: { cached_tokens: 800_000 } },
    0.2 * 1.4 + 0.8 * 0.26,
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

  it('prices cached prompt tokens reported at the end of a stream', async () => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }
        yield {
          choices: [],
          usage: {
            prompt_tokens: 1_000_000,
            completion_tokens: 0,
            total_tokens: 1_000_000,
            ...cacheFields,
          },
        }
      })()
    )

    const result = (await provider.executeRequest({
      model,
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })) as StreamingExecution
    await collectStream(result.stream)
    const { output } = await result.execution

    expect(output.tokens).toMatchObject({ input: 200_000, cacheRead: 800_000 })
    expect(output.cost?.input).toBeCloseTo(expectedInputCost, 8)
  })
})
