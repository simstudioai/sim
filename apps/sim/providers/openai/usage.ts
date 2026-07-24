import type { BlockTokens } from '@/executor/types'
import {
  LIST_PRICE_POLICY,
  type ModelCostPolicy,
  type ModelUsage,
  priceModelUsage,
} from '@/providers/cost-policy'
import {
  OPENAI_CACHE_WRITE_MULTIPLIER,
  type ResponsesUsageTokens,
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
}

interface OpenAIUsageCost {
  input: number
  output: number
  total: number
  toolCost?: number
  pricing: ModelPricing
}

function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
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
  }
}

/**
 * Adds one Responses API turn's usage without counting cache tokens as
 * uncached input.
 *
 * Normalization goes through {@link toOpenAIModelUsage} so that subtracting the
 * cache buckets out of the prompt total — and clamping a vendor payload that
 * reports more cache tokens than it processed — stays in one place.
 */
export function addOpenAIUsage(
  accumulator: OpenAIUsageAccumulator,
  usage: ResponsesUsageTokens | undefined
): void {
  if (!usage) return

  const normalized = toOpenAIModelUsage(usage)

  accumulator.input += tokenCount(normalized.input)
  accumulator.output += tokenCount(normalized.output)
  accumulator.cacheRead += tokenCount(normalized.cacheRead)
  for (const write of normalized.cacheWrites ?? []) {
    accumulator.cacheWrite += tokenCount(write.tokens)
  }
  accumulator.total += tokenCount(usage.totalTokens)
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
 * Builds the normalized usage for one OpenAI request.
 *
 * `input` is already the uncached remainder because {@link addOpenAIUsage}
 * subtracted the cache buckets per turn — unlike Anthropic, whose
 * `input_tokens` arrives exclusive of them.
 */
export function buildOpenAIModelUsage(accumulator: OpenAIUsageAccumulator): ModelUsage {
  return {
    input: accumulator.input,
    output: accumulator.output,
    cacheRead: accumulator.cacheRead,
    cacheWrites: [
      { tokens: accumulator.cacheWrite, inputRateMultiplier: OPENAI_CACHE_WRITE_MULTIPLIER },
    ],
  }
}

/**
 * Prices one OpenAI request, cache reads and writes included, through the
 * shared pricing function.
 */
export function buildOpenAIUsageCost(
  model: string,
  accumulator: OpenAIUsageAccumulator,
  toolCost = 0,
  policy: ModelCostPolicy = LIST_PRICE_POLICY
): OpenAIUsageCost {
  const cost = priceModelUsage(model, buildOpenAIModelUsage(accumulator), policy)

  return {
    input: cost.input,
    output: cost.output,
    total: roundedCost(cost.total + toolCost),
    ...(toolCost > 0 ? { toolCost } : {}),
    pricing: cost.pricing,
  }
}
