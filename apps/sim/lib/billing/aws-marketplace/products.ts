/**
 * How each AWS Marketplace listing is sold. Behavior lives in a plan, here in code; which product
 * codes exist is deployment configuration (`AWS_MARKETPLACE_PRODUCTS`), so adding, repricing, or
 * retiring a listing is a configuration change, never a branch.
 */

import type { usageLogCategoryEnum } from '@sim/db/schema'

type UsageLogCategory = (typeof usageLogCategoryEnum.enumValues)[number]

/**
 * Usage a listing bills through AWS: the organization's billed cost in `usage_log` for these
 * categories, reported hourly on `dimension` in whole units of `usdPerUnit`.
 */
export interface AwsMarketplaceUsagePricing {
  readonly dimension: string
  readonly usdPerUnit: number
  readonly categories: readonly UsageLogCategory[]
}

/** How one listing is sold, and so what Sim requires before granting access. */
interface AwsMarketplacePlan {
  readonly id: string
  /**
   * The entitlement dimension that must be current for a license to count as active. Null accepts
   * any current entitlement, which suits a listing with a single contract dimension.
   */
  readonly requiredDimension: string | null
  /** Usage billed through AWS on top of the contract; null bills nothing beyond it. */
  readonly usage: AwsMarketplaceUsagePricing | null
}

const PLANS = [
  /** A contract-only listing: any current entitlement grants access. */
  { id: 'contract', requiredDimension: null, usage: null },
  /**
   * Platform access by contract, plus LLM usage on Sim's keys billed through AWS as credits of
   * one cent. Bring-your-own-key usage is logged as `model_unbilled` and never reaches AWS.
   */
  {
    id: 'platform-with-usage',
    requiredDimension: 'platform',
    usage: { dimension: 'llm_credits', usdPerUnit: 0.01, categories: ['model'] },
  },
] as const satisfies readonly AwsMarketplacePlan[]

const AWS_MARKETPLACE_PLANS: ReadonlyMap<string, AwsMarketplacePlan> = new Map(
  PLANS.map((plan) => [plan.id, plan])
)

export interface AwsMarketplaceProduct {
  readonly productCode: string
  readonly plan: AwsMarketplacePlan
}

/** The products a deployment sells, by product code. */
export type AwsMarketplaceProducts = ReadonlyMap<string, AwsMarketplaceProduct>

/**
 * Parses `AWS_MARKETPLACE_PRODUCTS`: comma-separated `<product code>=<plan>` pairs, for example
 * `abc123=contract,def456=platform-with-usage`. Throws on a malformed entry, an unknown plan, or a
 * repeated code.
 */
export function parseAwsMarketplaceProducts(value: string): AwsMarketplaceProducts {
  const products = new Map<string, AwsMarketplaceProduct>()
  for (const entry of value.split(',')) {
    const [productCode, planId, ...rest] = entry.split('=').map((part) => part.trim())
    if (!productCode || !planId || rest.length > 0) {
      throw new Error(
        `AWS_MARKETPLACE_PRODUCTS: expected <product code>=<plan>, got "${entry.trim()}"`
      )
    }
    const plan = AWS_MARKETPLACE_PLANS.get(planId)
    if (!plan) {
      throw new Error(
        `AWS_MARKETPLACE_PRODUCTS: unknown plan "${planId}"; expected one of ${[...AWS_MARKETPLACE_PLANS.keys()].join(', ')}`
      )
    }
    if (products.has(productCode)) {
      throw new Error(`AWS_MARKETPLACE_PRODUCTS: product code "${productCode}" is listed twice`)
    }
    products.set(productCode, { productCode, plan })
  }
  return products
}
