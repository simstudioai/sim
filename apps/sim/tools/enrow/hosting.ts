import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Enrow hosted keys. Provide keys as `ENROW_API_KEY_COUNT`
 * plus `ENROW_API_KEY_1..N`.
 */
export const ENROW_API_KEY_PREFIX = 'ENROW_API_KEY'

/**
 * Dollar cost of a single Enrow credit.
 *
 * Sourced from the published plan rates on https://enrow.io/pricing: Start
 * $17 / 1,000 credits ($0.017/credit), Pro $87 / 10,000 ($0.0087), Scale
 * $397 / 50,000 ($0.00794). The email finder costs 1 credit per valid result
 * and the email verifier costs 0.25 credits per verification.
 *
 * UNCONFIRMED — do not treat as established: whether $0.017 actually recovers
 * hosted-key cost. The pricing page toggles between Annually (-40%), Monthly
 * (-30%), and Pay-as-you-go, and we could not determine which mode the $17
 * figure belongs to without account visibility. If $17 is a discounted rate,
 * undiscounted pay-as-you-go is higher and this constant under-bills. Settling
 * it needs a look at an actual Enrow invoice.
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
