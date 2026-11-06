import {
  getEmbeddingModelPricing,
  getModelPricing as getModelPricingFromDefinitions,
} from '@/providers/models'
import type { ModelPricing, ModelPricingTier } from '@/providers/types'

/** Returns registered model pricing without applying the display-only fallback. */
export function getModelPricing(modelId: string): ModelPricing | null {
  return getEmbeddingModelPricing(modelId) ?? getModelPricingFromDefinitions(modelId)
}

/** Resolves the rates for the full request input size: the base pricing or the matching tier. */
export function resolveModelTokenPricing(
  pricing: ModelPricing,
  inputTokens: number
): ModelPricing | ModelPricingTier {
  let resolved: ModelPricing | ModelPricingTier = pricing
  let resolvedThreshold = Number.NEGATIVE_INFINITY

  for (const tier of pricing.tiers ?? []) {
    if (inputTokens > tier.aboveInputTokens && tier.aboveInputTokens > resolvedThreshold) {
      resolved = tier
      resolvedThreshold = tier.aboveInputTokens
    }
  }

  return resolved
}

/** A cache write bucket and its premium over the model's base input rate. */
interface CacheWriteUsage {
  tokens: number
  /** Anthropic: 1.25 (5m) or 2 (1h). OpenAI: 1.25 on GPT-5.6+, free before it. */
  inputRateMultiplier: number
}

/**
 * Normalized token usage for one model call.
 *
 * Providers report cache usage in incompatible shapes — Anthropic's
 * `input_tokens` already excludes cache tokens, while OpenAI's `cached_tokens`
 * and Gemini's `cachedContentTokenCount` are subsets of their prompt totals.
 * Each provider adapter resolves that difference before building this; nothing
 * downstream branches on provider again.
 */
export interface ModelUsage {
  /** Tokens billed at the base input rate. Always EXCLUDES cache reads/writes. */
  input: number
  output: number
  /** Tokens served from the provider's cache, billed at the cachedInput rate. */
  cacheRead?: number
  /** Tokens written to the cache, each bucket at its own premium. */
  cacheWrites?: CacheWriteUsage[]
}

/** USD cost of one model call, split into input and output. */
export interface TokenUsageCost {
  input: number
  output: number
  total: number
}

/** Rounds a USD amount to the 8 decimal places every recorded cost carries. */
export function roundCost(value: number): number {
  return Number.parseFloat(value.toFixed(8))
}

/**
 * Prices normalized usage against a model's pricing table: the input-size tier
 * is resolved from every input token (uncached, cache reads, and cache writes),
 * cache reads bill at that tier's `cachedInput` rate (the input rate when the
 * model has none), and each cache write bills at the input rate times its
 * premium. `multiplier` scales input and output before rounding.
 *
 * Pure and dependency-free so the billing path and public cost estimators
 * share one computation.
 */
export function priceTokenUsage(
  pricing: ModelPricing,
  usage: ModelUsage,
  multiplier = 1
): TokenUsageCost {
  const cacheRead = usage.cacheRead ?? 0
  const cacheWrites = (usage.cacheWrites ?? []).filter((write) => write.tokens > 0)
  const totalInputTokens =
    usage.input + cacheRead + cacheWrites.reduce((total, write) => total + write.tokens, 0)
  const tokenPricing = resolveModelTokenPricing(pricing, totalInputTokens)
  const inputRate = tokenPricing.input / 1_000_000
  const cachedInputRate = (tokenPricing.cachedInput ?? tokenPricing.input) / 1_000_000

  const uncachedInputCost = usage.input * inputRate
  const cacheReadCost = cacheRead * cachedInputRate
  const cacheWriteCost = cacheWrites.reduce(
    (total, write) => total + write.tokens * inputRate * write.inputRateMultiplier,
    0
  )
  const input = roundCost((uncachedInputCost + cacheReadCost + cacheWriteCost) * multiplier)
  const output = roundCost(usage.output * (tokenPricing.output / 1_000_000) * multiplier)

  return {
    input,
    output,
    total: roundCost(input + output),
  }
}
