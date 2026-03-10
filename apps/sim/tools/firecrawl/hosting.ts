import type { ToolHostingConfig } from '@/tools/types'

/**
 * Firecrawl reports `creditsUsed` in tool responses. We bill hosted usage at
 * $0.001 per credit, which is a conservative approximation of Growth
 * auto-recharge pricing ($177 / 175,000 credits) from:
 * https://www.firecrawl.dev/pricing
 * https://docs.firecrawl.dev/billing
 */
export function createFirecrawlHosting<P extends { apiKey: string }>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: 'FIRECRAWL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'firecrawl',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        if (output.creditsUsed == null) {
          throw new Error('Firecrawl response missing creditsUsed field')
        }

        const creditsUsed = Number(output.creditsUsed)
        if (Number.isNaN(creditsUsed)) {
          throw new Error('Firecrawl response returned a non-numeric creditsUsed field')
        }

        return {
          cost: creditsUsed * 0.001,
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
