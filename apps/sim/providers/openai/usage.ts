import type { BlockTokens } from '@/executor/types'
import { LIST_PRICE_POLICY, priceModelUsage } from '@/providers/cost-policy'
import {
  type ResponsesUsageTokens,
  splitOpenAIUsage,
  toOpenAIModelUsage,
} from '@/providers/openai/utils'
import type { ModelPricing } from '@/providers/types'

export interface OpenAIUsageAccumulator {
  /**
   * Tokens billed at the base input rate. EXCLUDES cache reads and writes,
   * which OpenAI reports as subsets of `input_tokens` and which are billed at
   * their own rates.
   */
  input: number
  output: number
  /** Every token the request consumed, cache reads and writes included. */
  total: number
  cacheRead: number
  cacheWrite: number
  /** Per-request usage retained so input-size pricing tiers apply to each provider request. */
  turns: ResponsesUsageTokens[]
}

interface OpenAIUsageCost {
  input: number
  output: number
  total: number
  toolCost?: number
  pricing: ModelPricing
}

function roundedCost(value: number): number {
  return Number.parseFloat(value.toFixed(8))
}

/**
 * Creates an empty accumulator for one OpenAI provider request.
 */
export function createOpenAIUsageAccumulator(): OpenAIUsageAccumulator {
  return {
    input: 0,
    output: 0,
    total: 0,
    cacheRead: 0,
    cacheWrite: 0,
    turns: [],
  }
}

/**
 * Adds one Responses API turn's usage without counting cache tokens as
 * uncached input.
 *
 * Normalization goes through {@link splitOpenAIUsage} so that subtracting the
 * cache buckets out of the prompt total — and clamping a vendor payload that
 * reports more cache tokens than it processed — stays in one place.
 */
export function addOpenAIUsage(
  accumulator: OpenAIUsageAccumulator,
  usage: ResponsesUsageTokens | undefined
): void {
  if (!usage) return

  const split = splitOpenAIUsage(usage)
  accumulator.turns.push(usage)

  accumulator.input += split.input
  accumulator.output += split.output
  accumulator.cacheRead += split.cacheRead
  accumulator.cacheWrite += split.cacheWrite
  accumulator.total += usage.totalTokens
}

/**
 * Builds the block token shape. `total` is OpenAI's own reported total, which
 * already counts cache reads and writes alongside the uncached remainder.
 */
export function buildOpenAIUsageTokens(
  accumulator: OpenAIUsageAccumulator
): Required<Pick<BlockTokens, 'input' | 'output' | 'total' | 'cacheRead' | 'cacheWrite'>> {
  return {
    input: accumulator.input,
    output: accumulator.output,
    total: accumulator.total,
    cacheRead: accumulator.cacheRead,
    cacheWrite: accumulator.cacheWrite,
  }
}

/**
 * Prices every OpenAI request in an execution, cache reads and writes included,
 * through the shared pricing function.
 *
 * Always at list price. Billability and the margin are applied once, centrally,
 * by `executeProviderRequest` — a provider applying them here would double-count
 * the multiplier.
 */
export function buildOpenAIUsageCost(
  model: string,
  accumulator: OpenAIUsageAccumulator,
  toolCost = 0
): OpenAIUsageCost {
  const emptyCost = priceModelUsage(model, { input: 0, output: 0 }, LIST_PRICE_POLICY)
  let input = 0
  let output = 0

  for (const turn of accumulator.turns) {
    const turnCost = priceModelUsage(model, toOpenAIModelUsage(turn), LIST_PRICE_POLICY)
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
