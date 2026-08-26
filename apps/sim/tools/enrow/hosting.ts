import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Enrow hosted keys. Provide keys as `ENROW_API_KEY_COUNT`
 * plus `ENROW_API_KEY_1..N`.
 */
export const ENROW_API_KEY_PREFIX = 'ENROW_API_KEY'

/**
 * Dollar cost of a single Enrow credit.
 *
 * Based on the entry Start plan ($17/month, 1,000 credits = $0.017/credit),
 * which matches Enrow's own Start unit price of $0.017/email for the finder.
 * Per-credit drops at higher tiers (Pro $0.0087, Scale $0.00794), so pricing at
 * the entry tier guarantees hosted-key cost recovery rather than under-billing.
 * The email finder costs 1 credit per valid result and the email verifier
 * costs 0.25 credits per verification.
 * Source: https://enrow.io/pricing
 */
export const ENROW_CREDIT_USD = 0.017

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
      // Enrow limits POST submissions to 10 req/s; GET result reads are not
      // rate limited, so polling does not consume the quota. 60 req/min stays
      // well inside the documented submission limit.
      requestsPerMinute: 60,
    },
  }
}
