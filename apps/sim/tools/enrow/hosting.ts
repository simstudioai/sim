import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Enrow hosted keys. Provide keys as `ENROW_API_KEY_COUNT`
 * plus `ENROW_API_KEY_1..N`.
 */
export const ENROW_API_KEY_PREFIX = 'ENROW_API_KEY'

/**
 * Dollar cost of a single Enrow credit.
 *
 * Enrow's Starter plan is $24/month for 2,000 finder credits/month — $0.012
 * per credit. The email verifier costs 0.25 credits per verification and the
 * email finder costs 1 credit per valid result.
 * Source: https://enrow.io/pricing
 */
export const ENROW_CREDIT_USD = 0.012

/**
 * Build an Enrow `hosting` config. `getCredits` returns the number of Enrow
 * credits consumed by the call, derived from the tool's final output.
 */
export function enrowHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ENROW_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'enrow',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * ENROW_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      // Enrow rate limit is ~50 req/s; cap at 60 req/min to stay conservative
      // and avoid bursting into the limit during polling.
      requestsPerMinute: 60,
    },
  }
}
