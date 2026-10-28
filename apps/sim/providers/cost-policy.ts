import { getCostMultiplier } from '@/lib/core/config/env-flags'
import type { NormalizedBlockOutput } from '@/executor/types'
import {
  getModelPricing,
  type ModelUsage,
  priceTokenUsage,
  roundCost,
  type TokenUsageCost,
} from '@/providers/pricing'
import type { ModelPricing } from '@/providers/types'
import { calculateCost, shouldBillModelUsage } from '@/providers/utils'

/**
 * Single source of truth for whether a model response is charged to the caller
 * and at what margin.
 *
 * Two concerns are deliberately separated:
 * - Providers own token → USD *pricing*; they alone know cache tiers, reasoning
 *   tokens, and per-turn accumulation.
 * - This module owns billing *policy*: whether Sim supplied the credentials at
 *   all, and the production margin multiplier.
 *
 * Every surface that turns tokens into a charge — the streaming and
 * non-streaming provider paths, Router, Evaluator, and Pi — resolves policy
 * here, so a model costs the same no matter which path produced it.
 */

/** Cost shape written onto block output. Mirrors `BlockCost`. */
export interface ModelCost extends TokenUsageCost {
  toolCost?: number
  pricing?: ModelPricing
}

/** Cost that always carries pricing, as `ProviderResponse['cost']` requires. */
export type PricedModelCost = ModelCost & { pricing: ModelPricing }

export interface ModelCostPolicy {
  /** True when Sim supplied the credentials and must charge for the tokens. */
  billable: boolean
  /** Margin applied to billable model cost; `0` when the call is not billable. */
  multiplier: number
}

/**
 * Prices at the vendor's list rate with no margin.
 *
 * Provider adapters use this: they price tokens the vendor charged, and the
 * central layer applies the billability gate and margin afterwards (via
 * {@link applyModelCostPolicy} or {@link installStreamingCostPolicy}). A
 * provider applying the policy itself would double-count the multiplier.
 */
export const LIST_PRICE_POLICY: ModelCostPolicy = Object.freeze({
  billable: true,
  multiplier: 1,
})

/** Pricing echoed on a zero cost so consumers can tell "not billed" from "unpriced". */
const NOT_BILLED_PRICING: ModelPricing = Object.freeze({
  input: 0,
  output: 0,
  updatedAt: new Date(0).toISOString(),
})

/**
 * Resolves the billing policy for a model response.
 *
 * A response is billable only when the model is one Sim hosts (so Sim's own key
 * paid the provider) and the workspace did not supply its own key.
 */
export function resolveModelCostPolicy(model: string, isBYOK = false): ModelCostPolicy {
  const billable = !isBYOK && shouldBillModelUsage(model)
  return { billable, multiplier: billable ? getCostMultiplier() : 0 }
}

/** Zero model cost, preserving any tool cost already charged at the tool's own rate. */
export function notBilledCost(toolCost = 0): PricedModelCost {
  return {
    input: 0,
    output: 0,
    total: roundCost(toolCost),
    ...(toolCost > 0 ? { toolCost } : {}),
    pricing: NOT_BILLED_PRICING,
  }
}

/**
 * Projects a model cost through the billing policy.
 *
 * Tool cost passes through untouched — it is already billed at the tool's own
 * rate by the tool layer and must not pick up the model margin.
 */
export function applyModelCostPolicy(
  cost: ModelCost | undefined,
  policy: ModelCostPolicy
): ModelCost {
  const toolCost = cost?.toolCost ?? 0

  if (!cost || !policy.billable) {
    return notBilledCost(toolCost)
  }

  if (policy.multiplier === 1) {
    return cost
  }

  const modelTotal = cost.total - toolCost

  return {
    ...cost,
    input: roundCost(cost.input * policy.multiplier),
    output: roundCost(cost.output * policy.multiplier),
    total: roundCost(modelTotal * policy.multiplier + toolCost),
  }
}

/**
 * Applies the billing policy to normalized usage and prices it, through `priceTokenUsage` when
 * the model has registered pricing.
 *
 * Every surface that turns tokens into a charge routes through here, so a cache
 * hit is priced identically whether it came from Anthropic, OpenAI, Gemini, or
 * an OpenAI-compatible vendor. Callers must not pre-apply the policy multiplier
 * or the cached rate themselves.
 *
 * Token counts are validated by the provider adapter that builds the
 * {@link ModelUsage}, which is the only layer that knows the vendor's shape and
 * can enforce that cache buckets are a subset of the prompt total. This function
 * re-validates nothing.
 */
export function priceModelUsage(
  model: string,
  usage: ModelUsage,
  policy: ModelCostPolicy
): PricedModelCost {
  if (!policy.billable) {
    return notBilledCost()
  }

  const pricing = getModelPricing(model)

  if (pricing) {
    return { ...priceTokenUsage(pricing, usage, policy.multiplier), pricing }
  }

  const cacheRead = usage.cacheRead ?? 0
  const cacheWrites = (usage.cacheWrites ?? []).filter((write) => write.tokens > 0)
  const multiplier = policy.multiplier
  const base = calculateCost(model, usage.input, usage.output, false, multiplier, multiplier)
  const read = cacheRead > 0 ? calculateCost(model, cacheRead, 0, true, multiplier, 0) : undefined

  let writeInputCost = 0
  for (const write of cacheWrites) {
    writeInputCost += calculateCost(
      model,
      write.tokens,
      0,
      false,
      multiplier * write.inputRateMultiplier,
      0
    ).input
  }

  const input = roundCost(base.input + (read?.input ?? 0) + writeInputCost)
  const output = base.output

  return {
    input,
    output,
    total: roundCost(input + output),
    pricing: base.pricing,
  }
}

/**
 * Prices tokens for a model and applies the billing policy in one step. Use
 * wherever a caller holds raw token counts and needs the charge Sim records.
 *
 * Cache-free by design: a caller that has cache usage also knows its tiers, so
 * it builds a {@link ModelUsage} and calls {@link priceModelUsage} directly.
 */
export function calculateBillableModelCost(
  model: string,
  promptTokens = 0,
  completionTokens = 0,
  options: { isBYOK?: boolean } = {}
): PricedModelCost {
  return priceModelUsage(
    model,
    { input: promptTokens, output: completionTokens },
    resolveModelCostPolicy(model, options.isBYOK)
  )
}

/**
 * Drops a tool cost a provider folded into its own total.
 *
 * `executeProviderRequest` re-derives tool cost from `response.toolResults` and
 * adds it after the policy is applied, so a provider that already accounted for
 * it would otherwise have it counted twice.
 */
export function withoutToolCost(cost: ModelCost): ModelCost {
  if (cost.toolCost === undefined) return cost

  const { toolCost: _toolCost, ...model } = cost
  return { ...model, total: roundCost(model.input + model.output) }
}

/** Rejects NaN, Infinity, and negatives — a negative would credit the run. */
function billableAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Reads the cost off a provider-operation result.
 *
 * The provider boundary already resolved key provenance and applied the policy, so its cost
 * is authoritative and must never be recomputed from token counts — the caller
 * cannot see whether a workspace BYOK key paid for the call. A response with no
 * usable cost carried no billable usage.
 */
export function resolveProxiedModelCost(cost: unknown): ModelCost {
  if (!cost || typeof cost !== 'object') {
    return notBilledCost()
  }

  const { input, output, total, toolCost, pricing } = cost as Partial<ModelCost>
  return {
    input: billableAmount(input),
    output: billableAmount(output),
    total: billableAmount(total),
    ...(toolCost === undefined ? {} : { toolCost: billableAmount(toolCost) }),
    // Kept so downstream cost estimators can tell a priced zero from an
    // unpriced block and leave the charge alone.
    ...(pricing ? { pricing } : {}),
  }
}

/**
 * Applies the billing policy to a streaming block output.
 *
 * Streaming providers write their final cost from inside the stream drain, long
 * after `executeRequest` returns, so the policy is installed as an accessor
 * rather than applied to a value. A cost already present — providers that
 * settle their tool loop before returning — becomes the initial value, so its
 * tool cost survives.
 */
export function installStreamingCostPolicy(
  output: NormalizedBlockOutput,
  policy: ModelCostPolicy,
  additionalToolCost?: () => number
): void {
  let raw = output.cost as ModelCost | undefined

  Object.defineProperty(output, 'cost', {
    get: () => {
      const projected = applyModelCostPolicy(raw, policy)
      const additional = additionalToolCost?.() ?? 0
      if (!Number.isFinite(additional) || additional <= 0) return projected

      return {
        ...projected,
        toolCost: roundCost((projected.toolCost ?? 0) + additional),
        total: roundCost(projected.total + additional),
      }
    },
    set: (value: ModelCost | undefined) => {
      raw = value
    },
    configurable: true,
    enumerable: true,
  })
}

/**
 * Zeroes per-segment model cost on already-populated time segments when the
 * call is not billable.
 *
 * Segment costs come from the trace enrichers, which price tokens without
 * knowing key provenance. Block-level cost stays authoritative for billing —
 * `calculateCostSummary` skips model children of a span that has its own cost —
 * so this only keeps the displayed breakdown from contradicting it.
 */
export function applySegmentCostPolicy(
  segments: Array<{ type?: string; cost?: { input?: number; output?: number; total?: number } }>,
  policy: ModelCostPolicy
): void {
  if (policy.billable) return

  for (const segment of segments) {
    if (segment.type === 'model' && segment.cost) {
      segment.cost = { input: 0, output: 0, total: 0 }
    }
  }
}
