import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for ZeroBounce hosted keys. Provide keys as
 * `ZEROBOUNCE_API_KEY_COUNT` plus `ZEROBOUNCE_API_KEY_1..N`.
 */
export const ZEROBOUNCE_API_KEY_PREFIX = 'ZEROBOUNCE_API_KEY'

/**
 * Dollar cost of a single ZeroBounce validation credit. ZeroBounce charges one
 * credit per email validated; estimated from the volume credit tiers and
 * rounded up for smaller plans — https://www.zerobounce.net/pricing/.
 */
export const ZEROBOUNCE_CREDIT_USD = 0.007

/**
 * Build a ZeroBounce `hosting` config. `getCredits` returns the number of
 * validation credits the call consumed (one per validated email).
 */
export function zerobounceHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ZEROBOUNCE_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'zerobounce',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * ZEROBOUNCE_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      // ZeroBounce caps /validate at 80k/10s per key (~480k/min); 20/sec per
      // workspace leaves large upstream headroom while keeping enrichment fast.
      requestsPerMinute: 1200,
    },
  }
}
