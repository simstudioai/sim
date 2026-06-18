import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Datagma hosted keys. Provide keys as
 * `DATAGMA_API_KEY_COUNT` plus `DATAGMA_API_KEY_1..N`.
 *
 * Note: Datagma authenticates via an `apiId` URL query parameter (its only
 * documented scheme), so the key appears verbatim in every request URL and may
 * be captured by Datagma's and any intermediary's access logs. Treat a leaked
 * key accordingly and rotate via the env vars above.
 */
export const DATAGMA_API_KEY_PREFIX = 'DATAGMA_API_KEY'

/**
 * Dollar cost of a single Datagma credit.
 *
 * Based on the entry Regular plan ($49/month, 3,000 emails ≈ $0.0163/credit);
 * per-credit drops at higher tiers (Popular/Expert) and on annual billing.
 * Email finder: 1 credit per verified email. Phone finder: 30 credits per mobile.
 * Enrichment: 2 credits per successful response.
 * Pricing source: https://datagma.com/pricing
 */
export const DATAGMA_CREDIT_USD = 0.0163

/**
 * Build a Datagma `hosting` config. `getCredits` returns the number of Datagma
 * credits the call consumed, derived from the tool's output (per the documented
 * per-endpoint credit model at https://datagmaapi.readme.io/reference/getting-started-with-your-api).
 */
export function datagmaHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: DATAGMA_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'datagma',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * DATAGMA_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
