import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Dropcontact hosted keys. Provide keys as
 * `DROPCONTACT_API_KEY_COUNT` plus `DROPCONTACT_API_KEY_1..N`.
 */
export const DROPCONTACT_API_KEY_PREFIX = 'DROPCONTACT_API_KEY'

/**
 * Dollar cost of a single Dropcontact credit.
 *
 * Dropcontact's Starter plan is €79/month for 500 credits (≈ $0.158/credit at
 * parity). Credits are only deducted when a verified business email is
 * successfully returned; no charge if no email is found.
 *
 * Pricing source: https://www.dropcontact.com/pricing (retrieved 2026-05)
 *
 * NOTE: This is an approximation based on the Starter plan rate. Actual
 * per-credit cost varies by plan tier and currency. A human should verify
 * before deploying hosted-key billing.
 */
export const DROPCONTACT_CREDIT_USD = 0.17

/**
 * Build a Dropcontact `hosting` config. `getCredits` returns the number of
 * Dropcontact credits the call consumed, derived from the tool's final output.
 */
export function dropcontactHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: DROPCONTACT_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'dropcontact',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * DROPCONTACT_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      // Dropcontact rate limit: 60 requests per second = 3600 requests per minute
      // Source: https://developer.dropcontact.com (retrieved 2026-05)
      mode: 'per_request',
      requestsPerMinute: 3600,
    },
  }
}
