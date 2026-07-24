/**
 * @vitest-environment node
 */
import { envFlagsMockFns, resetEnvFlagsMock } from '@sim/testing'
import { afterEach, describe, expect, it } from 'vitest'
import type { NormalizedBlockOutput } from '@/executor/types'
import {
  applyModelCostPolicy,
  applySegmentCostPolicy,
  calculateBillableModelCost,
  installStreamingCostPolicy,
  LIST_PRICE_POLICY,
  priceModelUsage,
  resolveModelCostPolicy,
  resolveProxiedModelCost,
  withoutToolCost,
} from '@/providers/cost-policy'
import { calculateCost } from '@/providers/utils'

/** A model Sim hosts, so its usage is billable when no BYOK key is present. */
const HOSTED_MODEL = 'claude-opus-4-6'
/** A model reached only with a caller-supplied key, so Sim never bills it. */
const SELF_KEYED_MODEL = 'llama-3.3-70b-versatile'

describe('resolveModelCostPolicy', () => {
  afterEach(resetEnvFlagsMock)

  it('bills hosted models at the configured multiplier', () => {
    envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
    expect(resolveModelCostPolicy(HOSTED_MODEL)).toEqual({ billable: true, multiplier: 2 })
  })

  it('does not bill when the workspace supplied its own key', () => {
    envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
    expect(resolveModelCostPolicy(HOSTED_MODEL, true)).toEqual({ billable: false, multiplier: 0 })
  })

  it('does not bill models Sim does not host', () => {
    expect(resolveModelCostPolicy(SELF_KEYED_MODEL)).toEqual({ billable: false, multiplier: 0 })
  })
})

describe('applyModelCostPolicy', () => {
  it('scales model cost by the multiplier and leaves tool cost untouched', () => {
    const projected = applyModelCostPolicy(
      { input: 1, output: 2, total: 3.5, toolCost: 0.5 },
      { billable: true, multiplier: 2 }
    )

    expect(projected).toMatchObject({ input: 2, output: 4, total: 6.5, toolCost: 0.5 })
  })

  it('returns the cost unchanged when the multiplier is 1', () => {
    const cost = { input: 1, output: 2, total: 3 }
    expect(applyModelCostPolicy(cost, { billable: true, multiplier: 1 })).toBe(cost)
  })

  it('zeroes model cost but preserves tool cost when not billable', () => {
    const projected = applyModelCostPolicy(
      { input: 1, output: 2, total: 3.25, toolCost: 0.25 },
      { billable: false, multiplier: 0 }
    )

    expect(projected).toMatchObject({ input: 0, output: 0, total: 0.25, toolCost: 0.25 })
  })
})

describe('priceModelUsage', () => {
  /** Claude Sonnet 5: $2/MTok input, $0.20/MTok cached, $10/MTok output. */
  const PRICED_MODEL = 'claude-sonnet-5'
  const PER_TOKEN_INPUT = 2 / 1_000_000

  it('prices cache reads at the cached rate, not the base rate', () => {
    const cached = priceModelUsage(
      PRICED_MODEL,
      { input: 0, output: 0, cacheRead: 100_000 },
      LIST_PRICE_POLICY
    )
    const uncached = priceModelUsage(PRICED_MODEL, { input: 100_000, output: 0 }, LIST_PRICE_POLICY)

    expect(cached.input).toBeCloseTo(uncached.input / 10, 8)
  })

  it('prices each write bucket at its own premium over the base input rate', () => {
    const cost = priceModelUsage(
      PRICED_MODEL,
      {
        input: 0,
        output: 0,
        cacheWrites: [
          { tokens: 100_000, inputRateMultiplier: 1.25 },
          { tokens: 100_000, inputRateMultiplier: 2 },
        ],
      },
      LIST_PRICE_POLICY
    )

    expect(cost.input).toBeCloseTo(100_000 * PER_TOKEN_INPUT * 3.25, 8)
  })

  it('matches the plain uncached calculation when there is no cache activity', () => {
    const priced = priceModelUsage(PRICED_MODEL, { input: 1000, output: 500 }, LIST_PRICE_POLICY)
    const direct = calculateCost(PRICED_MODEL, 1000, 500)

    expect(priced).toMatchObject({
      input: direct.input,
      output: direct.output,
      total: direct.total,
    })
  })

  it('applies the policy multiplier to every bucket', () => {
    const usage = {
      input: 1000,
      output: 500,
      cacheRead: 2000,
      cacheWrites: [{ tokens: 1000, inputRateMultiplier: 1.25 }],
    }

    const single = priceModelUsage(PRICED_MODEL, usage, { billable: true, multiplier: 1 })
    const tripled = priceModelUsage(PRICED_MODEL, usage, { billable: true, multiplier: 3 })

    expect(tripled.total).toBeCloseTo(single.total * 3, 8)
  })

  it('charges nothing when the policy is not billable', () => {
    const cost = priceModelUsage(
      PRICED_MODEL,
      { input: 1000, output: 500, cacheRead: 5000 },
      { billable: false, multiplier: 0 }
    )

    expect(cost).toMatchObject({ input: 0, output: 0, total: 0 })
  })

  it('ignores negative and non-finite token counts rather than crediting the run', () => {
    const cost = priceModelUsage(
      PRICED_MODEL,
      {
        input: 1000,
        output: 0,
        cacheRead: -5000,
        cacheWrites: [{ tokens: 1000, inputRateMultiplier: Number.NaN }],
      },
      LIST_PRICE_POLICY
    )

    expect(cost.input).toBeCloseTo(1000 * PER_TOKEN_INPUT, 8)
  })

  /**
   * The regression this guards: Anthropic reports `input_tokens` already
   * excluding cache tokens while OpenAI and Gemini report a cached subset of
   * the prompt total. A normalization mistake in either adapter shows up as
   * two different prices for one real token split.
   */
  it('prices the same real token split identically across opposite wire shapes', () => {
    const anthropicShaped = priceModelUsage(
      PRICED_MODEL,
      { input: 1000, output: 500, cacheRead: 4000 },
      LIST_PRICE_POLICY
    )

    const openAIPromptTotal = 5000
    const openAICached = 4000
    const openAIShaped = priceModelUsage(
      PRICED_MODEL,
      {
        input: openAIPromptTotal - openAICached,
        output: 500,
        cacheRead: openAICached,
      },
      LIST_PRICE_POLICY
    )

    expect(openAIShaped).toEqual(anthropicShaped)
  })
})

describe('withoutToolCost', () => {
  it('removes a provider-folded tool cost and rebases the total', () => {
    expect(withoutToolCost({ input: 1, output: 2, total: 3.5, toolCost: 0.5 })).toEqual({
      input: 1,
      output: 2,
      total: 3,
    })
  })

  it('leaves a model-only cost untouched', () => {
    const cost = { input: 1, output: 2, total: 3 }
    expect(withoutToolCost(cost)).toBe(cost)
  })
})

describe('calculateBillableModelCost', () => {
  afterEach(resetEnvFlagsMock)

  it('matches the streaming projection for the same tokens', () => {
    envFlagsMockFns.getCostMultiplier.mockReturnValue(3)

    const nonStreaming = calculateBillableModelCost(HOSTED_MODEL, 1000, 500)
    const unscaled = calculateBillableModelCost(HOSTED_MODEL, 1000, 500)
    // The streaming path projects a provider cost computed without the
    // multiplier, so remove it before comparing against the direct calculation.
    const providerCost = {
      input: unscaled.input / 3,
      output: unscaled.output / 3,
      total: unscaled.total / 3,
    }
    const streaming = applyModelCostPolicy(providerCost, resolveModelCostPolicy(HOSTED_MODEL))

    expect(streaming.total).toBeCloseTo(nonStreaming.total, 8)
  })

  it('returns a zero cost carrying pricing for models Sim does not host', () => {
    const cost = calculateBillableModelCost(SELF_KEYED_MODEL, 1000, 500)
    expect(cost).toMatchObject({ input: 0, output: 0, total: 0 })
    expect(cost.pricing).toBeDefined()
  })
})

describe('installStreamingCostPolicy', () => {
  afterEach(resetEnvFlagsMock)

  it('applies the multiplier to cost written after the stream starts', () => {
    const output = { cost: { input: 0, output: 0, total: 0 } } as NormalizedBlockOutput
    installStreamingCostPolicy(output, { billable: true, multiplier: 2 })

    output.cost = { input: 1, output: 2, total: 3 }

    expect(output.cost).toMatchObject({ input: 2, output: 4, total: 6 })
  })

  it('keeps tool cost from a settled stream that wrote its cost before the policy was installed', () => {
    const output = {
      cost: { input: 1, output: 2, total: 3.75, toolCost: 0.75 },
    } as NormalizedBlockOutput

    installStreamingCostPolicy(output, { billable: false, multiplier: 0 })

    expect(output.cost).toMatchObject({ input: 0, output: 0, total: 0.75, toolCost: 0.75 })
  })

  it('zeroes model cost written by a provider for a model Sim does not host', () => {
    const output = { cost: { input: 0, output: 0, total: 0 } } as NormalizedBlockOutput
    installStreamingCostPolicy(output, resolveModelCostPolicy(SELF_KEYED_MODEL))

    output.cost = { input: 0.5, output: 1.5, total: 2 }

    expect(output.cost).toMatchObject({ input: 0, output: 0, total: 0 })
  })
})

describe('applySegmentCostPolicy', () => {
  it('zeroes model segments only when the call is not billable', () => {
    const segments = [
      { type: 'model', cost: { input: 1, output: 2, total: 3 } },
      { type: 'tool', cost: { total: 0.01 } },
    ]

    applySegmentCostPolicy(segments, { billable: true, multiplier: 1 })
    expect(segments[0].cost).toMatchObject({ total: 3 })

    applySegmentCostPolicy(segments, { billable: false, multiplier: 0 })
    expect(segments[0].cost).toMatchObject({ input: 0, output: 0, total: 0 })
    expect(segments[1].cost).toMatchObject({ total: 0.01 })
  })
})

describe('resolveProxiedModelCost', () => {
  it('passes through the proxy cost without recomputing it', () => {
    const pricing = { input: 5, output: 25, updatedAt: '2026-04-01' }
    expect(
      resolveProxiedModelCost({ input: 1, output: 2, total: 3, toolCost: 0.5, pricing })
    ).toEqual({
      input: 1,
      output: 2,
      total: 3,
      toolCost: 0.5,
      pricing,
    })
  })

  it('treats a missing or malformed cost as no billable usage', () => {
    expect(resolveProxiedModelCost(undefined)).toMatchObject({ input: 0, output: 0, total: 0 })
    expect(resolveProxiedModelCost(0.003)).toMatchObject({ input: 0, output: 0, total: 0 })
    expect(resolveProxiedModelCost({ input: Number.NaN, output: 1, total: 1 })).toMatchObject({
      input: 0,
      output: 1,
      total: 1,
    })
    expect(
      resolveProxiedModelCost({ input: 1, output: 1, total: Number.POSITIVE_INFINITY })
    ).toMatchObject({ total: 0 })
    expect(resolveProxiedModelCost({ input: 1, output: 1, total: '2' })).toMatchObject({ total: 0 })
  })

  it('never lets a corrupt negative figure credit the run', () => {
    expect(resolveProxiedModelCost({ input: -5, output: -1, total: -6 })).toMatchObject({
      input: 0,
      output: 0,
      total: 0,
    })
    expect(resolveProxiedModelCost({ input: 1, output: 1, total: 2, toolCost: -3 })).toMatchObject({
      toolCost: 0,
    })
  })
})
