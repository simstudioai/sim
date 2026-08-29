import type { ToolHostingConfig } from '@/tools/types'

/**
 * Env var prefix for Enrow hosted keys. Provide keys as `ENROW_API_KEY_COUNT`
 * plus `ENROW_API_KEY_1..N`.
 */
export const ENROW_API_KEY_PREFIX = 'ENROW_API_KEY'

/**
 * Dollar cost of a single Enrow credit, as billed to a hosted-key workspace.
 *
 * The email finder costs 1 credit per valid result
 * (https://docs.enrow.io/api-reference/email-finder/find-single) and the email
 * verifier 0.25 credits per check, which that endpoint reports back on the
 * response (https://docs.enrow.io/api-reference/email-verifier/verify-single).
 *
 * Enrow's published monthly tiers are Start $17 / 1,000 credits ($0.017),
 * Pro $87 / 10,000 ($0.0087) and Scale $397 / 50,000 ($0.00794), with a 40%
 * annual discount and a custom tier above that (https://enrow.io/pricing).
 * This rate sits between the Start and Pro per-credit prices and therefore
 * does not correspond to any single published tier; it can only be pinned by
 * the plan the hosted `ENROW_API_KEY_*` keys are actually enrolled on. Do not
 * adjust it from the public price list alone — a wrong value over- or
 * under-bills every hosted Enrow call.
 */
export const ENROW_CREDIT_USD = 0.012

/**
 * Build an Enrow `hosting` config. `getCredits` returns the number of Enrow
 * credits consumed by the call, derived from the tool's final output.
 */
export function enrowHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ENROW_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'enrow',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        return { cost: credits * ENROW_CREDIT_USD, metadata: { credits } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      /*
       * A per-workspace cap on hosted-key tool *executions* — not on outbound
       * provider requests. The limiter is consulted once per `executeTool`
       * call, so the poll loop's own GETs are not counted against it; nothing
       * here throttles a single call's polling.
       *
       * That is the right shape for what Enrow actually publishes. Its
       * documented limit is 10 req/s per API key on every *POST* endpoint —
       * 600/min (https://docs.enrow.io/rate-limits). Each execution issues
       * exactly one POST, so 60/min sits an order of magnitude under the
       * documented ceiling. The polling GETs are not covered by that limit at
       * all, and each one is separated by a 3s interval within a 120s budget.
       */
      requestsPerMinute: 60,
    },
  }
}
