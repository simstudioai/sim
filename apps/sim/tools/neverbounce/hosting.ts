import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for NeverBounce hosted keys. Provide keys as
 * `NEVERBOUNCE_API_KEY_COUNT` plus `NEVERBOUNCE_API_KEY_1..N`.
 */
export const NEVERBOUNCE_API_KEY_PREFIX = 'NEVERBOUNCE_API_KEY'

/**
 * Dollar cost of a single NeverBounce verification credit. NeverBounce charges
 * one credit per email checked; estimated from the pay-as-you-go tiers and
 * rounded up for smaller plans — https://neverbounce.com/pricing.
 */
export const NEVERBOUNCE_CREDIT_USD = 0.008

/**
 * Build a NeverBounce `hosting` config. `getCredits` returns the number of
 * verification credits the call consumed (one per checked email).
 */
export function neverbounceHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: NEVERBOUNCE_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'neverbounce',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * NEVERBOUNCE_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
