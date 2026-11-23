import { describe, expect, it } from 'vitest'
import { priceGeminiTokens, splitGeminiUsage } from '@/providers/gemini/usage'
import { calculateCost } from '@/providers/utils'

/** input 0.30/M, cachedInput 0.03/M, output 2.50/M. */
const MODEL = 'gemini-2.5-flash'

function usage(
  promptTokenCount: number,
  candidatesTokenCount: number,
  cachedContentTokenCount: number
) {
  return splitGeminiUsage({
    promptTokenCount,
    candidatesTokenCount,
    cachedContentTokenCount,
    totalTokenCount: promptTokenCount + candidatesTokenCount,
  })
}

describe('splitGeminiUsage', () => {
  it('subtracts the cached subset out of the prompt total', () => {
    expect(usage(100_000, 1_000, 80_000)).toEqual({
      input: 20_000,
      output: 1_000,
      cacheRead: 80_000,
    })
  })

  it('leaves the prompt total intact when nothing was cached', () => {
    expect(usage(100_000, 1_000, 0)).toEqual({
      input: 100_000,
      output: 1_000,
      cacheRead: 0,
    })
  })

  it('never bills more tokens than the prompt contained when cached is over-reported', () => {
    // Cached is a subset of the prompt total, so it can never exceed it.
    // Leaving it unclamped would bill 4,000 cached tokens on a 1,000-token prompt.
    expect(usage(1_000, 10, 4_000)).toEqual({
      input: 0,
      output: 10,
      cacheRead: 1_000,
    })
    expect(usage(1_000, 10, -5)).toEqual({
      input: 1_000,
      output: 10,
      cacheRead: 0,
    })
  })
})

describe('priceGeminiTokens', () => {
  it('charges cached tokens at the discounted rate instead of the base input rate', () => {
    const cost = priceGeminiTokens(MODEL, usage(100_000, 1_000, 80_000))

    expect(cost.input).toBeCloseTo(20_000 * 0.0000003 + 80_000 * 0.00000003, 10)
    expect(cost.output).toBeCloseTo(1_000 * 0.0000025, 10)
    expect(cost.total).toBeCloseTo(0.0109, 10)
  })

  it('matches plain calculateCost exactly when there is no cache hit', () => {
    expect(priceGeminiTokens(MODEL, usage(100_000, 1_000, 0))).toEqual(
      calculateCost(MODEL, 100_000, 1_000)
    )
  })
})
