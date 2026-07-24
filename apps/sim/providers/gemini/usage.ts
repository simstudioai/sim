import { LIST_PRICE_POLICY, type PricedModelCost, priceModelUsage } from '@/providers/cost-policy'
import type { GeminiUsage } from '@/providers/gemini/types'

/**
 * One Gemini response's tokens split into the buckets that price differently.
 * `input` is the uncached remainder, so `input + cacheRead` is the prompt total
 * Gemini reported.
 */
export interface GeminiTokenSplit {
  input: number
  output: number
  cacheRead: number
}

/**
 * Splits a cache-inclusive Gemini prompt total into the uncached remainder and
 * the cache read.
 *
 * Gemini's implicit context cache (on by default from 2.5 onward) reports cached
 * tokens as a subset of the prompt total — `cachedContentTokenCount` inside
 * `promptTokenCount` on generateContent, `total_cached_tokens` inside
 * `total_input_tokens` on the Interactions API. Charging the prompt total at the
 * base input rate therefore bills cache hits at full price; the subtraction is
 * what routes them to the model's discounted `cachedInput` rate instead.
 */
export function splitGeminiTokens(
  promptTokens: number,
  candidatesTokens: number,
  cachedTokens: number
): GeminiTokenSplit {
  const prompt = Math.max(0, promptTokens)
  // Clamped to the prompt total: a payload reporting more cached tokens than it
  // processed would otherwise bill more input than the request contained.
  const cacheRead = Math.min(Math.max(0, cachedTokens), prompt)

  return {
    input: prompt - cacheRead,
    output: candidatesTokens,
    cacheRead,
  }
}

/** {@link splitGeminiTokens} for the generateContent usage shape. */
export function splitGeminiUsage(usage: GeminiUsage): GeminiTokenSplit {
  return splitGeminiTokens(
    usage.promptTokenCount,
    usage.candidatesTokenCount,
    usage.cachedContentTokenCount
  )
}

/**
 * Prices a split through the shared cache-aware pricing function. With no cache
 * hit this matches pricing the whole prompt total at the base input rate.
 *
 * Always at list price. Billability and the margin are applied once, centrally,
 * by `executeProviderRequest` — a provider applying them here would double-count
 * the multiplier.
 */
export function priceGeminiTokens(model: string, split: GeminiTokenSplit): PricedModelCost {
  return priceModelUsage(model, split, LIST_PRICE_POLICY)
}
