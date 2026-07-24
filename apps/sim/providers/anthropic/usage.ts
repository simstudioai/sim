import type { BlockTokens } from '@/executor/types'
import type { ModelPricing } from '@/providers/types'
import { calculateCost } from '@/providers/utils'

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

  accumulator.input += tokenCount(usage.input_tokens)
  accumulator.output += tokenCount(usage.output_tokens)
  accumulator.cacheRead += tokenCount(usage.cache_read_input_tokens)

  const cacheWriteTotal = tokenCount(usage.cache_creation_input_tokens)
  if (!usage.cache_creation) {
    accumulator.cacheWriteFiveMinute += cacheWriteTotal
    return
  }

  const fiveMinute = tokenCount(usage.cache_creation.ephemeral_5m_input_tokens)
  const oneHour = tokenCount(usage.cache_creation.ephemeral_1h_input_tokens)
  const detailedTotal = fiveMinute + oneHour

  accumulator.cacheWriteFiveMinute += fiveMinute + Math.max(0, cacheWriteTotal - detailedTotal)
  accumulator.cacheWriteOneHour += oneHour
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

/**
 * Prices Anthropic prompt-cache tiers independently from ordinary input.
 */
export function buildAnthropicUsageCost(
  model: string,
  accumulator: AnthropicUsageAccumulator,
  toolCost = 0
): AnthropicUsageCost {
  const standard = calculateCost(model, accumulator.input, accumulator.output)
  const cacheRead = calculateCost(model, accumulator.cacheRead, 0, true)
  const fiveMinuteWrite = calculateCost(model, accumulator.cacheWriteFiveMinute, 0, false, 1.25)
  const oneHourWrite = calculateCost(model, accumulator.cacheWriteOneHour, 0, false, 2)
  const input = roundedCost(
    standard.input + cacheRead.input + fiveMinuteWrite.input + oneHourWrite.input
  )
  const output = standard.output
  const total = roundedCost(input + output + toolCost)

  return {
    input,
    output,
    total,
    ...(toolCost > 0 ? { toolCost } : {}),
    pricing: standard.pricing,
  }
}
