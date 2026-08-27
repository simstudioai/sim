import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for SMARTe hosted keys. Configure keys as
 * `SMARTE_API_KEY_COUNT` plus `SMARTE_API_KEY_1..N`.
 */
export const SMARTE_API_KEY_PREFIX = 'SMARTE_API_KEY'

/**
 * Public Pro-plan price for one SMARTe credit.
 *
 * SMARTe defines one credit as one successful data operation and lists Pro
 * credits at $0.50 each. Successful enrichment responses report actual usage
 * in the `credits-deducted` response header, which every hosted operation uses
 * as its billing source of truth.
 *
 * Pricing source: https://www.smarte.pro/pricing
 * Credit metadata source: https://docs.smarte.pro/docs/credit-usage-and-limits
 */
export const SMARTE_CREDIT_USD = 0.5

/**
 * SMARTe documents organization-wide, contract-specific rate limits without a
 * public numeric ceiling. Ten requests per minute per workspace is a
 * deliberately conservative local limit for the shared hosted-key pool.
 *
 * Rate-limit source: https://docs.smarte.pro/docs/rate-limiting
 */
export const SMARTE_REQUESTS_PER_MINUTE = 10

export function smarteHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: SMARTE_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'smarte',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const credits = output.creditsDeducted
        if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) {
          throw new Error(
            'SMARTe response missing a valid credits-deducted header; hosted cost cannot be determined'
          )
        }
        return {
          cost: credits * SMARTE_CREDIT_USD,
          metadata: { credits },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: SMARTE_REQUESTS_PER_MINUTE,
    },
  }
}
