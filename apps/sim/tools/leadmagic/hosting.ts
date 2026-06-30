import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for LeadMagic hosted keys. Provide keys as
 * `LEADMAGIC_API_KEY_COUNT` plus `LEADMAGIC_API_KEY_1..N`.
 */
export const LEADMAGIC_API_KEY_PREFIX = 'LEADMAGIC_API_KEY'

/**
 * Dollar cost of a single LeadMagic credit.
 *
 * LeadMagic charges only when data is found (not_found results are free).
 * Based on the entry Basic plan ($49/month, 2,000 credits ≈ $0.0245/credit);
 * per-credit drops at higher tiers (Essential/Growth). Email finder: 1 credit.
 * Mobile finder: 5 credits. Company search: 1 credit.
 *
 * Source: https://leadmagic.io/pricing
 */
export const LEADMAGIC_CREDIT_USD = 0.0245

/**
 * Build a LeadMagic `hosting` config. `getCredits` returns the number of
 * LeadMagic credits the call consumed, derived from the tool's output (per the
 * documented per-endpoint credit model at https://leadmagic.io/docs).
 *
 * LeadMagic responses include a `credits_consumed` field on every endpoint.
 * When no result is found, `credits_consumed` is 0.
 */
export function leadmagicHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: LEADMAGIC_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'leadmagic',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * LEADMAGIC_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
