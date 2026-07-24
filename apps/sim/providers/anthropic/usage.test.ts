/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addAnthropicUsage,
  buildAnthropicUsageCost,
  buildAnthropicUsageTokens,
  createAnthropicUsageAccumulator,
} from '@/providers/anthropic/usage'

const MODEL = 'claude-sonnet-4-5'

describe('Anthropic usage aggregation', () => {
  it('prices uncached input and output normally', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, { input_tokens: 1_000_000, output_tokens: 1_000_000 })

    expect(buildAnthropicUsageTokens(usage)).toEqual({
      input: 1_000_000,
      output: 1_000_000,
      total: 2_000_000,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(buildAnthropicUsageCost(MODEL, usage)).toMatchObject({
      input: 3,
      output: 15,
      total: 18,
    })
  })

  it('prices cache reads at cached-input rates without discounting uncached input', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, {
      input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      output_tokens: 0,
    })

    expect(buildAnthropicUsageCost(MODEL, usage)).toMatchObject({
      input: 3.3,
      output: 0,
      total: 3.3,
    })
  })

  it('prices cache writes without details at the default five-minute tier', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, {
      input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      output_tokens: 0,
    })

    expect(buildAnthropicUsageCost(MODEL, usage)).toMatchObject({
      input: 3.75,
      total: 3.75,
    })
  })

  it('prices one-hour cache writes at twice the normal input rate', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, {
      input_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 0,
        ephemeral_1h_input_tokens: 1_000_000,
      },
      output_tokens: 0,
    })

    expect(buildAnthropicUsageCost(MODEL, usage)).toMatchObject({
      input: 6,
      total: 6,
    })
  })

  it('aggregates mixed uncached, read, five-minute, one-hour, and output usage', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, {
      input_tokens: 100_000,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 300_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 100_000,
        ephemeral_1h_input_tokens: 200_000,
      },
      output_tokens: 400_000,
    })

    expect(buildAnthropicUsageTokens(usage)).toEqual({
      input: 100_000,
      output: 400_000,
      total: 1_000_000,
      cacheRead: 200_000,
      cacheWrite: 300_000,
    })
    expect(buildAnthropicUsageCost(MODEL, usage)).toMatchObject({
      input: 1.935,
      output: 6,
      total: 7.935,
    })
  })

  it('accumulates each stream turn exactly once', () => {
    const usage = createAnthropicUsageAccumulator()
    addAnthropicUsage(usage, {
      input_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 30,
      output_tokens: 40,
    })
    addAnthropicUsage(usage, {
      input_tokens: 1,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 3,
      output_tokens: 4,
    })

    expect(buildAnthropicUsageTokens(usage)).toEqual({
      input: 11,
      output: 44,
      total: 110,
      cacheRead: 22,
      cacheWrite: 33,
    })
  })
})
