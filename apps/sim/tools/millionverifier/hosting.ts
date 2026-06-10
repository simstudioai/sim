import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for MillionVerifier hosted keys. Provide keys as
 * `MILLIONVERIFIER_API_KEY_COUNT` plus `MILLIONVERIFIER_API_KEY_1..N`.
 */
export const MILLIONVERIFIER_API_KEY_PREFIX = 'MILLIONVERIFIER_API_KEY'

/**
 * Dollar cost of a single MillionVerifier verification credit. MillionVerifier
 * charges one credit per email checked; estimated from the bulk credit plans
 * (≈ $0.0012/credit at volume) — https://millionverifier.com/pricing.
 */
export const MILLIONVERIFIER_CREDIT_USD = 0.0012

/**
 * Build a MillionVerifier `hosting` config. `getCredits` returns the number of
 * verification credits the call consumed (one per checked email).
 */
export function millionverifierHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: MILLIONVERIFIER_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'millionverifier',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * MILLIONVERIFIER_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      // MillionVerifier caps the real-time API at 160/sec per account (~9.6k/min);
      // 20/sec per workspace stays well under while keeping enrichment fast.
      requestsPerMinute: 1200,
    },
  }
}
