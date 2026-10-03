import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Anymail Finder hosted keys. Provide keys as
 * `ANYMAILFINDER_API_KEY_COUNT` plus `ANYMAILFINDER_API_KEY_1..N`.
 */
export const ANYMAILFINDER_API_KEY_PREFIX = 'ANYMAILFINDER_API_KEY'

/**
 * Dollar cost of one Anymail Finder credit.
 *
 * Anymail Finder charges per verified result: 1 credit per verified email
 * found, 2 per decision-maker email found, 0.2 per verification, and nothing
 * for a miss or for a repeat of the same search within 30 days. Estimated from
 * the $199/month 10,000-credit plan ($0.0199/credit) at
 * https://anymailfinder.com/pricing.
 */
export const ANYMAILFINDER_CREDIT_USD = 0.02

export const ANYMAILFINDER_API_BASE_URL = 'https://api.anymailfinder.com/v5.1'

export function anymailFinderHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Build an Anymail Finder `hosting` config. Every billable response states the
 * exact charge in `credits_charged` (0 on a miss or a 30-day repeat), so cost
 * is read from the output rather than inferred; a response without it cannot
 * be billed and throws.
 */
export function anymailFinderHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ANYMAILFINDER_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'anymailfinder',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const credits = output.credits_charged
        if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) {
          throw new Error('Response missing credits_charged field')
        }
        return { cost: credits * ANYMAILFINDER_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}

/** Reads the `{error, message}` body Anymail Finder returns on 400/401/402. */
export async function anymailFinderError(response: Response): Promise<string> {
  const errorData = (await response.json().catch(() => ({}))) as Record<string, string>
  return (
    errorData.message ||
    errorData.error ||
    `Anymail Finder API error: ${response.status} ${response.statusText}`
  )
}
