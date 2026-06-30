import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Icypeas hosted keys. Provide keys as `ICYPEAS_API_KEY_COUNT`
 * plus `ICYPEAS_API_KEY_1..N`.
 */
export const ICYPEAS_API_KEY_PREFIX = 'ICYPEAS_API_KEY'

/**
 * Dollar cost of a single Icypeas credit.
 *
 * Icypeas meters usage in credits at approximately $0.019/credit on the entry
 * Basic plan (1,000 credits for $19/month). Higher-tier plans reduce cost to as
 * low as $0.00499/credit. We use the Basic-plan rate as a conservative baseline.
 *
 * Credit costs per operation (source: https://www.icypeas.com/pricing):
 * - Email Finder: 1 credit per found email
 * - Email Verifier: 0.1 credit per verification
 * - Domain Scan: 1 credit per domain
 * - Profile Scraper: 1.5 credits per profile
 * - Reverse Email Lookup: 10 credits per found profile
 *
 * Credits are charged only when a result is returned (FOUND / DEBITED status).
 */
export const ICYPEAS_CREDIT_USD = 0.019

/**
 * Build an Icypeas `hosting` config. `getCredits` returns the number of Icypeas
 * credits the call consumed, derived from the tool's final output.
 */
export function icypeasHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ICYPEAS_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'icypeas',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * ICYPEAS_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
