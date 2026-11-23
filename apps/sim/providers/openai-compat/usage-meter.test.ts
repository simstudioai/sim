import { describe, expect, it } from 'vitest'
import { createChatCompletionUsageMeter } from '@/providers/openai-compat/usage-meter'

/** glm-5.2: input 1.40/M, cachedInput 0.26/M, output 4.40/M. */
const ZAI_MODEL = 'glm-5.2'

describe('createChatCompletionUsageMeter', () => {
  it('bills cache hits reported under prompt_tokens_details at the cached rate', () => {
    const meter = createChatCompletionUsageMeter(ZAI_MODEL)
    meter.record({
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      total_tokens: 1_100_000,
      prompt_tokens_details: { cached_tokens: 800_000 },
    })

    expect(meter.tokens).toEqual({
      input: 200_000,
      output: 100_000,
      cacheRead: 800_000,
      total: 1_100_000,
    })
    expect(meter.cost().input).toBeCloseTo(0.2 * 1.4 + 0.8 * 0.26, 8)
    expect(meter.cost().output).toBeCloseTo(0.1 * 4.4, 8)
  })

  it("reads DeepSeek's prompt_cache_hit_tokens", () => {
    const meter = createChatCompletionUsageMeter('deepseek-flash')
    meter.record({
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
      prompt_cache_hit_tokens: 1_000_000,
    })

    expect(meter.tokens.cacheRead).toBe(1_000_000)
    expect(meter.cost().input).toBeCloseTo(0.006, 8)
  })

  it('ignores a call that reported no usage', () => {
    const meter = createChatCompletionUsageMeter(ZAI_MODEL)
    meter.record(undefined)

    expect(meter.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, total: 0 })
    expect(meter.cost().total).toBe(0)
  })

  it('applies a long-context tier per call, not to the summed prompt', () => {
    const meter = createChatCompletionUsageMeter('grok-4.6')
    meter.record({ prompt_tokens: 150_000, completion_tokens: 0 })
    meter.record({ prompt_tokens: 150_000, completion_tokens: 0 })

    expect(meter.cost().input).toBeCloseTo(0.3 * 2, 8)
  })

  it('adds tool cost to the total without folding it into input or output', () => {
    const meter = createChatCompletionUsageMeter(ZAI_MODEL)
    meter.record({ prompt_tokens: 1_000_000, completion_tokens: 0 })

    expect(meter.cost(0.5)).toMatchObject({ input: 1.4, output: 0, total: 1.9, toolCost: 0.5 })
  })
})
