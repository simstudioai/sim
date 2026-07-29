/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  addOpenAIUsage,
  buildOpenAIUsageCost,
  buildOpenAIUsageTokens,
  createOpenAIUsageAccumulator,
} from '@/providers/openai/usage'
import type { ResponsesUsageTokens } from '@/providers/openai/utils'
import { calculateCost } from '@/providers/utils'

/** input $2.50/M, cachedInput $1.25/M, output $10.00/M. */
const MODEL = 'gpt-4o'
/** input $2.50/M, cachedInput $0.25/M, output $15.00/M — bills cache writes. */
const CACHE_WRITE_MODEL = 'gpt-5.6-terra'

/**
 * Builds a Responses usage payload. `promptTokens` is inclusive of cached and
 * written tokens, matching what {@link parseResponsesUsage} emits.
 */
function responsesUsage(partial: Partial<ResponsesUsageTokens>): ResponsesUsageTokens {
  const promptTokens = partial.promptTokens ?? 0
  const completionTokens = partial.completionTokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: partial.totalTokens ?? promptTokens + completionTokens,
    cachedTokens: partial.cachedTokens ?? 0,
    cacheWriteTokens: partial.cacheWriteTokens ?? 0,
    reasoningTokens: partial.reasoningTokens ?? 0,
  }
}

describe('OpenAI usage aggregation', () => {
  it('matches plain list pricing when nothing was cached', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 12_345, completionTokens: 6_789 }))

    const uncached = calculateCost(MODEL, 12_345, 6_789)

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 12_345,
      output: 6_789,
      total: 19_134,
      cacheRead: 0,
      cacheWrite: 0,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: uncached.input,
      output: uncached.output,
      total: uncached.total,
    })
  })

  it('bills cached tokens at the cached rate instead of the full input rate', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 1_000_000, cachedTokens: 600_000, completionTokens: 0 })
    )

    /** 400k uncached at $2.50/M plus 600k cached at $1.25/M. */
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: 1.75,
      output: 0,
      total: 1.75,
    })
    expect(calculateCost(MODEL, 1_000_000, 0).input).toBe(2.5)
  })

  it('reports cache reads separately while keeping the prompt total intact', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 1_000, cachedTokens: 800, completionTokens: 100 })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 200,
      output: 100,
      total: 1_100,
      cacheRead: 800,
      cacheWrite: 0,
    })
  })

  it('bills GPT-5.6 cache writes at 1.25x the uncached input rate', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        completionTokens: 0,
      })
    )

    /** 1M written at $2.50/M x 1.25. */
    expect(buildOpenAIUsageCost(CACHE_WRITE_MODEL, usage)).toMatchObject({
      input: 3.125,
      output: 0,
      total: 3.125,
    })
  })

  it('aggregates uncached, cached, written, and output tokens in one turn', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000_000,
        cachedTokens: 600_000,
        cacheWriteTokens: 200_000,
        completionTokens: 100_000,
      })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 200_000,
      output: 100_000,
      total: 1_100_000,
      cacheRead: 600_000,
      cacheWrite: 200_000,
    })
    /** 0.5 uncached + 0.15 cached + 0.625 written input, 1.5 output. */
    expect(buildOpenAIUsageCost(CACHE_WRITE_MODEL, usage)).toMatchObject({
      input: 1.275,
      output: 1.5,
      total: 2.775,
    })
  })

  it('accumulates each tool-loop turn exactly once', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000, completionTokens: 100 }))
    addOpenAIUsage(
      usage,
      responsesUsage({ promptTokens: 2_000, cachedTokens: 1_500, completionTokens: 200 })
    )

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 1_500,
      output: 300,
      total: 3_300,
      cacheRead: 1_500,
      cacheWrite: 0,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).toMatchObject({
      input: 0.005625,
      output: 0.003,
      total: 0.008625,
    })
  })

  it('ignores turns that reported no usage', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000, completionTokens: 100 }))
    addOpenAIUsage(usage, undefined)

    expect(buildOpenAIUsageTokens(usage)).toEqual({
      input: 1_000,
      output: 100,
      total: 1_100,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  it('adds tool cost to the total and only reports the field when charged', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(usage, responsesUsage({ promptTokens: 1_000_000, completionTokens: 0 }))

    expect(buildOpenAIUsageCost(MODEL, usage, 0.25)).toMatchObject({
      input: 2.5,
      total: 2.75,
      toolCost: 0.25,
    })
    expect(buildOpenAIUsageCost(MODEL, usage)).not.toHaveProperty('toolCost')
  })

  it('does not charge for cache tokens a vendor payload over-reported', () => {
    const usage = createOpenAIUsageAccumulator()
    addOpenAIUsage(
      usage,
      responsesUsage({
        promptTokens: 1_000,
        cachedTokens: 900,
        cacheWriteTokens: 400,
        completionTokens: 0,
      })
    )

    expect(buildOpenAIUsageTokens(usage)).toMatchObject({
      input: 0,
      cacheRead: 900,
      cacheWrite: 100,
    })
  })
})
