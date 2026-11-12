/**
 * The AWS Marketplace products this deployment sells, and how each one is sold.
 *
 * A product's behavior lives in its plan, here in code; which product codes exist is deployment
 * configuration (`AWS_MARKETPLACE_PRODUCTS`), because codes differ per seller account and listing.
 * Every Marketplace path resolves a license's product from the code AWS returned or the code stored
 * on its row, so adding, repricing, or retiring a listing is a configuration change, never a branch.
 *
 * Free of imports from `@/lib/core/config/env`, so `env.ts` can validate the setting at boot.
 */

/** How one listing is sold, and so what Sim requires before granting access. */
export interface AwsMarketplacePlan {
  /**
   * The entitlement dimension that must be current for a license to count as active. Null accepts
   * any current entitlement, which is right for a listing with a single contract dimension.
   */
  readonly requiredDimension: string | null
}

export const AWS_MARKETPLACE_PLANS = {
  /** A contract-only listing: any current entitlement grants access. */
  contract: { requiredDimension: null },
  /** Platform access by contract, plus LLM usage on Sim's keys billed through AWS. */
  'platform-with-usage': { requiredDimension: 'platform' },
} as const satisfies Record<string, AwsMarketplacePlan>

export type AwsMarketplacePlanId = keyof typeof AWS_MARKETPLACE_PLANS

export interface AwsMarketplaceProduct {
  readonly productCode: string
  readonly planId: AwsMarketplacePlanId
  readonly plan: AwsMarketplacePlan
}

function isPlanId(value: string): value is AwsMarketplacePlanId {
  return Object.hasOwn(AWS_MARKETPLACE_PLANS, value)
}

/**
 * Parses `AWS_MARKETPLACE_PRODUCTS`: comma-separated `<product code>=<plan>` pairs, for example
 * `abc123=contract,def456=platform-with-usage`. Throws on an empty entry, an unknown plan, or a
 * repeated code, so a misconfigured deployment fails at boot instead of refusing buyers later.
 */
export function parseAwsMarketplaceProducts(
  value: string
): ReadonlyMap<string, AwsMarketplaceProduct> {
  const products = new Map<string, AwsMarketplaceProduct>()
  for (const entry of value.split(',')) {
    const [productCode, planId, ...rest] = entry.split('=').map((part) => part.trim())
    if (!productCode || !planId || rest.length > 0) {
      throw new Error(`expected <product code>=<plan>, received "${entry.trim()}"`)
    }
    if (!isPlanId(planId)) {
      throw new Error(
        `unknown plan "${planId}"; expected one of ${Object.keys(AWS_MARKETPLACE_PLANS).join(', ')}`
      )
    }
    if (products.has(productCode)) throw new Error(`product code "${productCode}" is listed twice`)
    products.set(productCode, { productCode, planId, plan: AWS_MARKETPLACE_PLANS[planId] })
  }
  return products
}

/** `parseAwsMarketplaceProducts` as a predicate, for env validation. */
export function isValidAwsMarketplaceProducts(value: string): boolean {
  try {
    parseAwsMarketplaceProducts(value)
    return true
  } catch {
    return false
  }
}
