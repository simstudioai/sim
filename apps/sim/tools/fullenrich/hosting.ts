import { requireFullEnrichCredits } from '@/tools/fullenrich/utils'
import type { ToolHostingConfig } from '@/tools/types'

export const FULLENRICH_API_KEY_PREFIX = 'FULLENRICH_API_KEY'

/**
 * USD value of one FullEnrich credit for hosted billing.
 *
 * Basis verified 2026-08-26: the lowest sustainable recurring self-serve paid
 * tier is Pro Monthly at $29 for 500 credits, so $29 / 500 = $0.058/credit.
 * The free trial and custom Enterprise pricing are excluded by design.
 * Source: https://fullenrich.com/pricing.md (page updated 2026-07-07).
 */
export const FULLENRICH_CREDIT_USD = 0.058

export const FULLENRICH_PRICING_BASIS =
  'Pro Monthly $29 / 500 credits = $0.058 per credit; https://fullenrich.com/pricing.md; verified 2026-08-26'

/**
 * Official per-result credit weights used for deterministic async estimates.
 * Source: https://fullenrich.com/pricing.md; verified 2026-08-26.
 */
export const FULLENRICH_CREDIT_WEIGHTS = {
  workEmail: 1,
  personalEmail: 3,
  mobilePhone: 10,
  reverseEmail: 1,
  profile: 0.25,
} as const

/**
 * Conservative shared-key limit. FullEnrich documents 60 requests/minute per
 * workspace across all endpoints; hosted traffic is capped at 10/minute.
 * Sources: https://docs.fullenrich.com/api/v2/general/ratelimit and
 * https://docs.fullenrich.com/api/v2/implement-in-product/volume; verified 2026-08-26.
 */
const FULLENRICH_RATE_LIMIT = {
  mode: 'per_request' as const,
  requestsPerMinute: 10,
}

/** Build hosted-key pricing from exact credits reported in the tool output. */
export function fullEnrichExactHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FULLENRICH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'fullenrich',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = requireFullEnrichCredits(getCredits(params, output), 'FullEnrich credits')
        return {
          cost: credits * FULLENRICH_CREDIT_USD,
          metadata: {
            credits,
            creditUsd: FULLENRICH_CREDIT_USD,
            estimate: false,
            pricingBasis: FULLENRICH_PRICING_BASIS,
          },
        }
      },
    },
    rateLimit: FULLENRICH_RATE_LIMIT,
  }
}

/**
 * Build hosted-key pricing for an asynchronous initiating request.
 *
 * FullEnrich does not return final usage with the initiating enrichment ID, so
 * the estimate assumes every requested result succeeds and applies the official
 * per-result credit weights. This intentionally conservative upper bound is
 * deterministic from validated request parameters.
 */
export function fullEnrichEstimatedHosting<P>(
  getEstimatedCredits: (params: P) => number,
  estimateBasis: string
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FULLENRICH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'fullenrich',
    pricing: {
      type: 'custom',
      getCost: (params) => {
        const credits = requireFullEnrichCredits(
          getEstimatedCredits(params),
          'FullEnrich estimated credits'
        )
        return {
          cost: credits * FULLENRICH_CREDIT_USD,
          metadata: {
            credits,
            creditUsd: FULLENRICH_CREDIT_USD,
            estimate: true,
            estimateBasis,
            pricingBasis: FULLENRICH_PRICING_BASIS,
          },
        }
      },
    },
    rateLimit: FULLENRICH_RATE_LIMIT,
  }
}

/** Build hosted-key configuration for result retrieval that consumes no new credits. */
export function fullEnrichRetrievalHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FULLENRICH_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'fullenrich',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const historicalCredits = requireFullEnrichCredits(
          output.costCredits,
          'FullEnrich historical enrichment credits'
        )
        return {
          cost: 0,
          metadata: {
            credits: 0,
            historicalCredits,
            creditUsd: FULLENRICH_CREDIT_USD,
            estimate: false,
            pricingBasis: 'Result retrieval consumes no additional FullEnrich credits',
          },
        }
      },
    },
    rateLimit: FULLENRICH_RATE_LIMIT,
  }
}
