import { LIST_PRICE_POLICY, type PricedModelCost, priceModelUsage } from '@/providers/cost-policy'

/** xAI usage fields returned by Chat Completions. */
export interface XAIUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  prompt_tokens_details?: { cached_tokens?: number | null } | null
  completion_tokens_details?: { reasoning_tokens?: number | null } | null
  /** Exact provider charge where 10 billion ticks equal one US dollar. */
  cost_in_usd_ticks?: number | null
}

export type XAIServiceTier = 'default' | 'priority'

export interface XAITurnUsage {
  tokens: {
    input: number
    output: number
    total: number
    cacheRead?: number
    reasoning?: number
  }
  cost: PricedModelCost
  /** Present even when the exact charge is zero. */
  providerCostTicks?: number
}

export interface XAIUsageTotals {
  tokens: XAITurnUsage['tokens']
  cost: PricedModelCost
  /** Sum of exact provider charges, kept as ticks to avoid per-turn float drift. */
  providerCostTicks: number
  /** Catalog-priced total for turns where xAI omitted its exact charge. */
  fallbackCost: number
}

const USD_TICKS_PER_DOLLAR = 10_000_000_000

const finiteTokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

const finiteCostTicks = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const roundUsd = (value: number, decimalPlaces = 10): number =>
  Number.parseFloat(value.toFixed(decimalPlaces))

function applyAuthoritativeTotal(
  catalogCost: PricedModelCost,
  authoritativeTotal: number,
  hasInputTokens: boolean
): PricedModelCost {
  const inputShare =
    catalogCost.total > 0 ? catalogCost.input / catalogCost.total : hasInputTokens ? 1 : 0
  const input = roundUsd(authoritativeTotal * inputShare)
  const output = roundUsd(authoritativeTotal - input)

  return { ...catalogCost, input, output, total: authoritativeTotal }
}

/** Returns a documented xAI processing tier and rejects vendor extensions. */
export function normalizeXAIServiceTier(value: unknown): XAIServiceTier | undefined {
  return value === 'default' || value === 'priority' ? value : undefined
}

/**
 * Resolves the tier that was actually billed. Priority pricing is only safe to
 * infer when xAI explicitly confirms it on the response.
 */
export function resolveXAIServiceTier(reportedServiceTier: unknown): XAIServiceTier {
  return normalizeXAIServiceTier(reportedServiceTier) === 'priority' ? 'priority' : 'default'
}

/**
 * Normalizes and prices one xAI response.
 *
 * `prompt_tokens` includes cache reads, while Sim's canonical `input` bucket
 * excludes them. xAI reports hidden reasoning tokens separately from visible
 * completion tokens, so canonical billed output is their sum while `reasoning`
 * remains available as metadata.
 * Catalog pricing supplies the input/output allocation; xAI's provider-reported
 * ticks, when present, set the authoritative per-turn total and the catalog
 * ratio splits that total between input and output.
 */
export function priceXAIUsage(
  model: string,
  usage: XAIUsage | null | undefined,
  options: {
    reportedServiceTier?: unknown
  } = {}
): XAITurnUsage {
  const promptTotal = finiteTokenCount(usage?.prompt_tokens)
  const visibleOutput = finiteTokenCount(usage?.completion_tokens)
  const cacheRead = Math.min(
    promptTotal,
    finiteTokenCount(usage?.prompt_tokens_details?.cached_tokens)
  )
  const input = promptTotal - cacheRead
  const reasoning = finiteTokenCount(usage?.completion_tokens_details?.reasoning_tokens)
  const output = visibleOutput + reasoning
  const reportedTotal = finiteTokenCount(usage?.total_tokens)
  const total = reportedTotal || promptTotal + output
  const serviceTier = resolveXAIServiceTier(options.reportedServiceTier)
  const catalogCost = priceModelUsage(
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
  const providerCostTicks = finiteCostTicks(usage?.cost_in_usd_ticks)
  const exactCost =
    providerCostTicks !== undefined ? providerCostTicks / USD_TICKS_PER_DOLLAR : undefined
  const cost =
    exactCost !== undefined
      ? applyAuthoritativeTotal(catalogCost, exactCost, promptTotal > 0)
      : catalogCost

  return {
    tokens: {
      input,
      output,
      total,
      ...(cacheRead > 0 ? { cacheRead } : {}),
      ...(reasoning > 0 ? { reasoning } : {}),
    },
    cost,
    ...(providerCostTicks !== undefined ? { providerCostTicks } : {}),
  }
}

/** Creates an empty accumulator carrying the model's catalog pricing metadata. */
export function createXAIUsageTotals(model: string): XAIUsageTotals {
  const emptyTurn = priceXAIUsage(model, undefined)
  return {
    tokens: { input: 0, output: 0, total: 0 },
    cost: { ...emptyTurn.cost, input: 0, output: 0, total: 0 },
    providerCostTicks: 0,
    fallbackCost: 0,
  }
}

/** Adds one independently priced xAI request to a multi-turn total. */
export function addXAIUsage(accumulator: XAIUsageTotals, turn: XAITurnUsage): void {
  accumulator.tokens.input += turn.tokens.input
  accumulator.tokens.output += turn.tokens.output
  accumulator.tokens.total += turn.tokens.total

  const cacheRead = (accumulator.tokens.cacheRead ?? 0) + (turn.tokens.cacheRead ?? 0)
  if (cacheRead > 0) accumulator.tokens.cacheRead = cacheRead

  const reasoning = (accumulator.tokens.reasoning ?? 0) + (turn.tokens.reasoning ?? 0)
  if (reasoning > 0) accumulator.tokens.reasoning = reasoning

  accumulator.cost.input = roundUsd(accumulator.cost.input + turn.cost.input)
  accumulator.cost.output = roundUsd(accumulator.cost.output + turn.cost.output)
  accumulator.cost.pricing = turn.cost.pricing

  if (turn.providerCostTicks !== undefined) {
    accumulator.providerCostTicks += turn.providerCostTicks
  } else {
    accumulator.fallbackCost = roundUsd(accumulator.fallbackCost + turn.cost.total)
  }

  accumulator.cost.total = roundUsd(
    accumulator.providerCostTicks / USD_TICKS_PER_DOLLAR + accumulator.fallbackCost
  )
}

/** Adds tool spend to an accumulated xAI model cost without mutating it. */
export function withXAIToolCost(cost: PricedModelCost, toolCost: number): PricedModelCost {
  if (!(toolCost > 0)) return cost

  return {
    ...cost,
    toolCost,
    total: roundUsd(cost.total + toolCost),
  }
}
