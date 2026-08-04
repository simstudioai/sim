import { LIST_PRICE_POLICY, type PricedModelCost, priceModelUsage } from '@/providers/cost-policy'

/** Usage subset returned by Fireworks' OpenAI-compatible Chat Completions API. */
export interface FireworksUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  prompt_tokens_details?: { cached_tokens?: number | null } | null
}

export interface FireworksUsageTotals {
  tokens: {
    input: number
    output: number
    total: number
    cacheRead?: number
  }
  cost: PricedModelCost
}

const finiteTokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

/**
 * Normalizes and prices one Fireworks response. Cached tokens are a subset of
 * prompt_tokens; they are removed from base input and priced at cachedInput.
 */
export function priceFireworksUsage(
  model: string,
  usage: FireworksUsage | null | undefined,
  serviceTier: 'default' | 'priority' = 'default'
): FireworksUsageTotals {
  const promptTotal = finiteTokenCount(usage?.prompt_tokens)
  const output = finiteTokenCount(usage?.completion_tokens)
  const cacheRead = Math.min(
    promptTotal,
    finiteTokenCount(usage?.prompt_tokens_details?.cached_tokens)
  )
  const input = promptTotal - cacheRead
  const total = finiteTokenCount(usage?.total_tokens) || promptTotal + output
  const cost = priceModelUsage(
    model,
    {
      input,
      output,
      ...(cacheRead > 0 ? { cacheRead } : {}),
      contextInputTokens: promptTotal,
      serviceTier,
    },
    LIST_PRICE_POLICY
  )

  return {
    tokens: { input, output, total, ...(cacheRead > 0 ? { cacheRead } : {}) },
    cost,
  }
}

export function addFireworksUsage(
  accumulator: FireworksUsageTotals,
  turn: FireworksUsageTotals
): void {
  accumulator.tokens.input += turn.tokens.input
  accumulator.tokens.output += turn.tokens.output
  accumulator.tokens.total += turn.tokens.total
  const cacheRead = (accumulator.tokens.cacheRead ?? 0) + (turn.tokens.cacheRead ?? 0)
  if (cacheRead > 0) accumulator.tokens.cacheRead = cacheRead

  accumulator.cost.input += turn.cost.input
  accumulator.cost.output += turn.cost.output
  accumulator.cost.total += turn.cost.total
  accumulator.cost.pricing = turn.cost.pricing
}

export function createFireworksUsageTotals(
  model: string,
  serviceTier: 'default' | 'priority' = 'default'
): FireworksUsageTotals {
  return priceFireworksUsage(model, undefined, serviceTier)
}
