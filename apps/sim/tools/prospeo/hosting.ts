import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Prospeo hosted keys. Provide keys as
 * `PROSPEO_API_KEY_COUNT` plus `PROSPEO_API_KEY_1..N`.
 */
export const PROSPEO_API_KEY_PREFIX = 'PROSPEO_API_KEY'

/**
 * Dollar cost of a single Prospeo credit.
 *
 * Prospeo charges per match: 1 credit per person/company match, 10 credits when
 * a mobile is revealed, and never on a no-match or a repeat enrichment. Based on
 * the $39/month Starter plan (1,000 credits ≈ $0.039/credit) — https://prospeo.io/pricing.
 */
export const PROSPEO_CREDIT_USD = 0.039

/**
 * Build a Prospeo `hosting` config. `getCredits` returns the number of Prospeo
 * credits the call consumed, derived from the tool's output (prefer the
 * API-reported `total_cost` for bulk endpoints; otherwise compute from the
 * `free`/`free_enrichment` flag and the match).
 */
export function prospeoHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: PROSPEO_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'prospeo',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * PROSPEO_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
