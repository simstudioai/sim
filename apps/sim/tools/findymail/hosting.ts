import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Findymail hosted keys. Provide keys as
 * `FINDYMAIL_API_KEY_COUNT` plus `FINDYMAIL_API_KEY_1..N`.
 */
export const FINDYMAIL_API_KEY_PREFIX = 'FINDYMAIL_API_KEY'

/**
 * Dollar cost of a single Findymail finder credit.
 *
 * Findymail charges per verified result: 1 credit per email, 10 credits per
 * phone, and only when a result is found. Estimated from the $99/month Starter
 * plan (5,000 credits ≈ $0.0198/credit) — https://www.findymail.com/pricing/.
 */
export const FINDYMAIL_CREDIT_USD = 0.02

/**
 * Build a Findymail `hosting` config. `getCredits` returns the number of
 * Findymail credits the call consumed, derived from the tool's output (per the
 * documented per-endpoint credit model at https://www.findymail.com/api/).
 */
export function findymailHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FINDYMAIL_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'findymail',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * FINDYMAIL_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
