import type { ToolHostingConfig } from '@/tools/types'

/** Env var prefix for Firecrawl hosted keys. */
export const FIRECRAWL_API_KEY_PREFIX = 'FIRECRAWL_API_KEY'

/**
 * Dollar cost of a single Firecrawl credit on Sim's hosted plan.
 *
 * Firecrawl is subscription-priced rather than pay-as-you-go, so this is the
 * effective per-credit rate of the plan the hosted keys belong to.
 *
 * Source: https://www.firecrawl.dev/pricing
 */
export const FIRECRAWL_CREDIT_USD = 0.001

/**
 * Reads the credits a Firecrawl response reported.
 *
 * Firecrawl reports usage in two documented places: job- and search-style
 * endpoints put `creditsUsed` on the response envelope, while per-page
 * endpoints put it on the returned document's metadata. Both are checked so a
 * tool can never be wired to the wrong one.
 *
 * Source: https://docs.firecrawl.dev/billing
 */
function readReportedCredits(output: Record<string, unknown>): unknown {
  const fromEnvelope = output.creditsUsed
  if (fromEnvelope != null) return fromEnvelope
  return (output.metadata as { creditsUsed?: unknown } | undefined)?.creditsUsed
}

/**
 * Builds the Firecrawl `hosting` config shared by every Firecrawl tool.
 *
 * All Firecrawl operations are usage-priced — option modifiers, page counts,
 * and result bands each change the credit count — so the charge always comes
 * from the credits the API reported rather than a fixed per-request rate.
 */
export function firecrawlHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FIRECRAWL_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'firecrawl',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const reported = readReportedCredits(output)
        if (reported == null) {
          throw new Error('Firecrawl response missing creditsUsed field')
        }

        const creditsUsed = Number(reported)
        if (!Number.isFinite(creditsUsed)) {
          throw new Error('Firecrawl response returned a non-numeric creditsUsed field')
        }

        return {
          cost: creditsUsed * FIRECRAWL_CREDIT_USD,
          metadata: { creditsUsed },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  }
}
