import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Wiza hosted keys. Provide keys as `WIZA_API_KEY_COUNT`
 * plus `WIZA_API_KEY_1..N`.
 */
export const WIZA_API_KEY_PREFIX = 'WIZA_API_KEY'

/**
 * Dollar cost of a single Wiza API credit.
 *
 * Wiza meters API usage in credits at a documented $0.025/credit (2,000-credit
 * minimum) — https://help.wiza.co/en/articles/13551713-how-to-purchase-api-credits.
 * Credits are deducted only when data is successfully returned: 2 credits per
 * valid email, 5 credits per phone, 2 credits per company enrichment.
 */
export const WIZA_CREDIT_USD = 0.025

/**
 * Build a Wiza `hosting` config. `getCredits` returns the number of Wiza API
 * credits the call consumed, derived from the tool's output.
 */
export function wizaHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: WIZA_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'wiza',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * WIZA_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
