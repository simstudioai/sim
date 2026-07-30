import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Context.dev hosted keys. Provide keys as
 * `CONTEXT_DEV_API_KEY_COUNT` plus `CONTEXT_DEV_API_KEY_1..N`.
 */
export const CONTEXT_DEV_API_KEY_PREFIX = 'CONTEXT_DEV_API_KEY'

/**
 * Dollar cost of a single Context.dev credit.
 *
 * Estimated from the $25/month Developer plan (10,000 credits = $0.0025/credit)
 * — https://www.context.dev/pricing. Endpoints cost 1, 5, or 10 credits
 * depending on operation; actual usage is read from each response's
 * `key_metadata.credits_consumed` rather than hardcoded per endpoint.
 */
export const CONTEXT_DEV_CREDIT_USD = 0.0025

/**
 * Build a Context.dev `hosting` config. Every Context.dev response reports the
 * exact credits consumed via `key_metadata.credits_consumed`, already surfaced
 * on tool output as `creditsConsumed` by `extractCreditMetadata` — so cost is
 * read directly from the response rather than estimated per endpoint.
 */
export function contextDevHosting<P>(): ToolHostingConfig<P> {
  return {
    envKeyPrefix: CONTEXT_DEV_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'context_dev',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const credits = (output.creditsConsumed as number | null) ?? 0
        return { cost: credits * CONTEXT_DEV_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 60,
    },
  }
}
