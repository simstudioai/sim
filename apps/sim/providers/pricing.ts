import {
  getEmbeddingModelPricing,
  getModelPricing as getModelPricingFromDefinitions,
} from '@/providers/models'
import type { ModelPricing, ModelTokenPricing } from '@/providers/types'

/** Returns registered model pricing without applying the display-only fallback. */
export function getModelPricing(modelId: string): ModelPricing | null {
  return getEmbeddingModelPricing(modelId) ?? getModelPricingFromDefinitions(modelId)
}

/** Resolves the token rates that apply to the full request input size. */
export function resolveModelTokenPricing(
  pricing: ModelPricing,
  inputTokens: number
): ModelTokenPricing {
  let resolved: ModelTokenPricing = pricing
  let resolvedThreshold = Number.NEGATIVE_INFINITY

  for (const tier of pricing.tiers ?? []) {
    if (inputTokens > tier.aboveInputTokens && tier.aboveInputTokens > resolvedThreshold) {
      resolved = tier
      resolvedThreshold = tier.aboveInputTokens
    }
  }

  return resolved
}
