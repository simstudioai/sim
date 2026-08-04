/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  addXAIUsage,
  createXAIUsageTotals,
  priceXAIUsage,
  resolveXAIServiceTier,
  withXAIToolCost,
} from '@/providers/xai/usage'

describe('priceXAIUsage', () => {
  it('normalizes cache and reasoning tokens and uses exact provider ticks', () => {
    const turn = priceXAIUsage('grok-4.5', {
      prompt_tokens: 250_000,
      completion_tokens: 10_000,
      total_tokens: 263_000,
      prompt_tokens_details: { cached_tokens: 100_000 },
      completion_tokens_details: { reasoning_tokens: 3_000 },
      cost_in_usd_ticks: 12_345_678,
    })

    expect(turn.tokens).toEqual({
      input: 150_000,
      output: 13_000,
      total: 263_000,
      cacheRead: 100_000,
      reasoning: 3_000,
    })
    expect(turn.providerCostTicks).toBe(12_345_678)
    expect(turn.cost.total).toBe(0.0012345678)
    expect(turn.cost.input + turn.cost.output).toBeCloseTo(turn.cost.total, 10)
  })

  it('prices each fallback turn with its own context and effective tier', () => {
    const first = priceXAIUsage('grok-4.5', {
      prompt_tokens: 100_000,
      completion_tokens: 10_000,
      total_tokens: 110_000,
      prompt_tokens_details: { cached_tokens: 20_000 },
    })
    const second = priceXAIUsage(
      'grok-4.5',
      {
        prompt_tokens: 200_000,
        completion_tokens: 10_000,
        total_tokens: 210_000,
        prompt_tokens_details: { cached_tokens: 100_000 },
      },
      { reportedServiceTier: 'priority' }
    )
    const totals = createXAIUsageTotals('grok-4.5')

    addXAIUsage(totals, first)
    addXAIUsage(totals, second)

    expect(first.cost).toMatchObject({ input: 0.166, output: 0.06, total: 0.226 })
    expect(second.cost).toMatchObject({ input: 0.92, output: 0.24, total: 1.16 })
    expect(totals.tokens).toEqual({
      input: 180_000,
      output: 20_000,
      total: 320_000,
      cacheRead: 120_000,
    })
    expect(totals.cost).toMatchObject({ input: 1.086, output: 0.3, total: 1.386 })
  })

  it('uses standard pricing when xAI reports the default tier', () => {
    const turn = priceXAIUsage(
      'grok-4.5',
      { prompt_tokens: 100_000, completion_tokens: 10_000, total_tokens: 110_000 },
      { reportedServiceTier: 'default' }
    )

    expect(turn.cost.total).toBe(0.26)
  })

  it('uses standard pricing when the response omits its effective tier', () => {
    const turn = priceXAIUsage('grok-4.5', {
      prompt_tokens: 100_000,
      completion_tokens: 10_000,
      total_tokens: 110_000,
    })

    expect(turn.cost.total).toBe(0.26)
  })

  it('treats zero provider ticks as an exact zero rather than using fallback pricing', () => {
    const turn = priceXAIUsage('grok-4.5', {
      prompt_tokens: 100_000,
      completion_tokens: 10_000,
      total_tokens: 110_000,
      cost_in_usd_ticks: 0,
    })

    expect(turn.providerCostTicks).toBe(0)
    expect(turn.cost).toMatchObject({ input: 0, output: 0, total: 0 })
  })
})

describe('xAI usage accumulation', () => {
  it('sums exact ticks and fallback-priced turns without aggregate repricing', () => {
    const totals = createXAIUsageTotals('grok-4.5')
    const exact = priceXAIUsage('grok-4.5', {
      prompt_tokens: 10_000,
      completion_tokens: 1_000,
      total_tokens: 11_000,
      cost_in_usd_ticks: 5_000_000,
    })
    const fallback = priceXAIUsage('grok-4.5', {
      prompt_tokens: 100_000,
      completion_tokens: 10_000,
      total_tokens: 110_000,
    })

    addXAIUsage(totals, exact)
    addXAIUsage(totals, fallback)

    expect(totals.providerCostTicks).toBe(5_000_000)
    expect(totals.fallbackCost).toBe(0.26)
    expect(totals.cost.total).toBe(0.2605)
    expect(totals.cost.input + totals.cost.output).toBeCloseTo(totals.cost.total, 10)
  })

  it('adds tool cost without mutating the model-only total', () => {
    const totals = createXAIUsageTotals('grok-4.5')
    addXAIUsage(
      totals,
      priceXAIUsage('grok-4.5', {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        cost_in_usd_ticks: 10_000_000,
      })
    )

    const finalCost = withXAIToolCost(totals.cost, 0.25)

    expect(totals.cost.total).toBe(0.001)
    expect(finalCost).toMatchObject({ toolCost: 0.25, total: 0.251 })
  })
})

describe('resolveXAIServiceTier', () => {
  it('only enables priority pricing when xAI confirms it', () => {
    expect(resolveXAIServiceTier('priority')).toBe('priority')
    expect(resolveXAIServiceTier('default')).toBe('default')
    expect(resolveXAIServiceTier('flex')).toBe('default')
    expect(resolveXAIServiceTier(undefined)).toBe('default')
  })
})
