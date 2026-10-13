import type { BlockTokens } from '@/executor/types'
import { LIST_PRICE_POLICY, type ModelUsage, priceModelUsage } from '@/providers/cost-policy'
import type { ModelPricing } from '@/providers/types'

export interface AnthropicUsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null
    ephemeral_1h_input_tokens?: number | null
  } | null
}

export interface AnthropicUsageAccumulator {
  input: number
  output: number
  cacheRead: number
  cacheWriteFiveMinute: number
  cacheWriteOneHour: number
  /** Complete response usage, retained so pricing tiers apply to individual prompts. */
  turns: ModelUsage[]
}

interface AnthropicUsageCost {
  input: number
  output: number
  total: number
  toolCost?: number
  pricing: ModelPricing
}

function tokenCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function roundedCost(value: number): number {
  return Number.parseFloat(value.toFixed(8))
}

/**
 * Creates an empty accumulator for one Anthropic provider request.
 */
export function createAnthropicUsageAccumulator(): AnthropicUsageAccumulator {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWriteFiveMinute: 0,
    cacheWriteOneHour: 0,
    turns: [],
  }
}

/**
 * Adds one Anthropic model response's usage without counting cache tokens as uncached input.
 */
export function addAnthropicUsage(
  accumulator: AnthropicUsageAccumulator,
  usage: AnthropicUsageLike | null | undefined
): void {
  if (!usage) return

  const cacheWriteTotal = tokenCount(usage.cache_creation_input_tokens)
  const turnUsage = {
    input: tokenCount(usage.input_tokens),
    output: tokenCount(usage.output_tokens),
    cacheRead: tokenCount(usage.cache_read_input_tokens),
    cacheWriteFiveMinute: cacheWriteTotal,
    cacheWriteOneHour: 0,
  }

  if (usage.cache_creation) {
    const fiveMinute = tokenCount(usage.cache_creation.ephemeral_5m_input_tokens)
    const oneHour = tokenCount(usage.cache_creation.ephemeral_1h_input_tokens)
    const detailedTotal = fiveMinute + oneHour
    turnUsage.cacheWriteFiveMinute = fiveMinute + Math.max(0, cacheWriteTotal - detailedTotal)
    turnUsage.cacheWriteOneHour = oneHour
  }

  accumulator.input += turnUsage.input
  accumulator.output += turnUsage.output
  accumulator.cacheRead += turnUsage.cacheRead
  accumulator.cacheWriteFiveMinute += turnUsage.cacheWriteFiveMinute
  accumulator.cacheWriteOneHour += turnUsage.cacheWriteOneHour
  accumulator.turns.push(buildAnthropicModelUsage(turnUsage))
}

/**
 * Builds the block token shape, including cache reads and writes in the total.
 */
export function buildAnthropicUsageTokens(
  accumulator: AnthropicUsageAccumulator
): Required<Pick<BlockTokens, 'input' | 'output' | 'total' | 'cacheRead' | 'cacheWrite'>> {
  const cacheWrite = accumulator.cacheWriteFiveMinute + accumulator.cacheWriteOneHour
  return {
    input: accumulator.input,
    output: accumulator.output,
    total: accumulator.input + accumulator.output + accumulator.cacheRead + cacheWrite,
    cacheRead: accumulator.cacheRead,
    cacheWrite,
  }
}

/** 5-minute cache writes cost 1.25x the base input rate, 1-hour writes 2x. */
const FIVE_MINUTE_WRITE_MULTIPLIER = 1.25
const ONE_HOUR_WRITE_MULTIPLIER = 2

/**
 * Builds normalized usage from Anthropic token counters.
 *
 * Anthropic reports `input_tokens` already excluding cache reads and writes
 * (`total_input = cache_read + cache_creation + input_tokens`), so `input` maps
 * across directly — unlike OpenAI and Gemini, whose cached counts are subsets
 * of their prompt totals and must be subtracted.
 */
export function buildAnthropicModelUsage(
  accumulator: Omit<AnthropicUsageAccumulator, 'turns'>
): ModelUsage {
  return {
    input: accumulator.input,
    output: accumulator.output,
    cacheRead: accumulator.cacheRead,
    cacheWrites: [
      {
        tokens: accumulator.cacheWriteFiveMinute,
        inputRateMultiplier: FIVE_MINUTE_WRITE_MULTIPLIER,
      },
      { tokens: accumulator.cacheWriteOneHour, inputRateMultiplier: ONE_HOUR_WRITE_MULTIPLIER },
    ],
  }
}

/** Normalizes one complete provider response without mixing it with previous model turns. */
export function toAnthropicModelUsage(usage: AnthropicUsageLike | null | undefined): ModelUsage {
  const accumulator = createAnthropicUsageAccumulator()
  addAnthropicUsage(accumulator, usage)
  return buildAnthropicModelUsage(accumulator)
}

/**
 * Prices each model response before summing the request, so long-context
 * rates depend on each prompt rather than accumulated tool-loop tokens.
 *
 * Always at list price. Billability and the margin are applied once, centrally,
 * by `executeProviderRequest` — a provider applying them here would double-count
 * the multiplier.
 */
export function buildAnthropicUsageCost(
  model: string,
  accumulator: AnthropicUsageAccumulator,
  toolCost = 0
): AnthropicUsageCost {
  const emptyCost = priceModelUsage(model, { input: 0, output: 0 }, LIST_PRICE_POLICY)
  let input = 0
  let output = 0
  for (const usage of accumulator.turns) {
    const turnCost = priceModelUsage(model, usage, LIST_PRICE_POLICY)
    input += turnCost.input
    output += turnCost.output
  }

  input = roundedCost(input)
  output = roundedCost(output)

  return {
    input,
    output,
    total: roundedCost(input + output + toolCost),
    ...(toolCost > 0 ? { toolCost } : {}),
    pricing: emptyCost.pricing,
  }
}
