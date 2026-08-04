import { describe, expect, it } from 'vitest'
import {
  addFireworksUsage,
  createFireworksUsageTotals,
  priceFireworksUsage,
} from '@/providers/fireworks/usage'

describe('Fireworks usage pricing', () => {
  const usage = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
    prompt_tokens_details: { cached_tokens: 400 },
  }

  it('separates cached input and applies the standard catalog rates', () => {
    const result = priceFireworksUsage('fireworks/minimax-m2.7', usage)

    expect(result.tokens).toEqual({ input: 600, cacheRead: 400, output: 200, total: 1200 })
    expect(result.cost).toMatchObject({ input: 0.0002036, output: 0.00024, total: 0.0004436 })
  })

  it('uses the documented Fireworks priority rates', () => {
    const result = priceFireworksUsage('fireworks/minimax-m2.7', usage, 'priority')

    expect(result.cost).toMatchObject({ input: 0.000306, output: 0.00036, total: 0.000666 })
  })

  it('clamps invalid cache usage and accumulates each provider turn independently', () => {
    const totals = createFireworksUsageTotals('fireworks/gpt-oss-120b')
    const first = priceFireworksUsage('fireworks/gpt-oss-120b', {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 500 },
    })
    const second = priceFireworksUsage('fireworks/gpt-oss-120b', {
      prompt_tokens: 50,
      completion_tokens: 10,
    })

    addFireworksUsage(totals, first)
    addFireworksUsage(totals, second)

    expect(totals.tokens).toEqual({ input: 50, cacheRead: 100, output: 30, total: 180 })
    expect(totals.cost.total).toBeCloseTo(first.cost.total + second.cost.total, 8)
  })
})
