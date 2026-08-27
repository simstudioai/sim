import type { ToolHostingConfig } from '@/tools/types'

export const ZELIQ_API_KEY_PREFIX = 'ZELIQ_API_KEY'
export const ZELIQ_PRICING_SOURCE_URL = 'https://www.zeliq.com/pricing'
export const ZELIQ_PRICING_SOURCE_DATE = '2026-08-26'
export const ZELIQ_RATE_LIMIT_SOURCE_URL = 'https://docs.zeliq.com/docs/api-pricing'
export const ZELIQ_STARTER_MONTHLY_USD = 59
export const ZELIQ_STARTER_MONTHLY_CREDITS = 750
export const ZELIQ_CREDIT_USD = ZELIQ_STARTER_MONTHLY_USD / ZELIQ_STARTER_MONTHLY_CREDITS
export const ZELIQ_PRICING_BASIS =
  'Starter monthly self-serve: $59 per user per month for 750 credits per month'
export const ZELIQ_STARTER_REQUESTS_PER_MINUTE = 200
export const ZELIQ_STARTER_REQUESTS_PER_HOUR = 400
export const ZELIQ_STARTER_REQUESTS_PER_DAY = 2_000
export const ZELIQ_HOSTED_REQUESTS_PER_MINUTE = 1
export const ZELIQ_ASYNC_BILLING_ASSUMPTION =
  'Conservative operation-derived estimate charged at submission: 1 credit for email or 10 credits for phone; callback credit_used may later be 0 when no match is found'

interface ZeliqHostingOptions<P> {
  operation: 'email' | 'phone'
  estimatedCredits: 1 | 10
  validateParams: (params: P) => unknown
}

function assertAcceptedSubmission(output: Record<string, unknown>): void {
  if (
    output.status !== 202 ||
    typeof output.message !== 'string' ||
    output.message.length === 0 ||
    typeof output.jobId !== 'string' ||
    output.jobId.length === 0
  ) {
    throw new Error('Zeliq hosted pricing requires a documented HTTP 202 acceptance output')
  }
}

/**
 * Builds hosted-key pricing for Zeliq enrichment submissions.
 *
 * Pricing source researched on 2026-08-26: https://www.zeliq.com/pricing.
 * The lowest recurring self-serve paid tier is Starter at $59/month for 750
 * credits, so the deterministic basis is $59 / 750 = $0.078666… per credit.
 * Official endpoint weights are 1 credit for successful email enrichment and
 * 10 credits for successful phone enrichment. Because Zeliq delivers the
 * actual `credit_used` later to the caller's callback URL, hosted metering uses
 * the operation weight as a conservative estimate at submission time. A
 * no-match callback can therefore cost Sim less than the estimated charge.
 *
 * Official API pricing and limits: https://docs.zeliq.com/docs/api-pricing.
 * Starter permits 200 requests/minute, 400/hour, and 2,000/day per organization.
 * Sim limits each workspace to 1 request/minute so one continuously active
 * workspace remains below the plan's hourly and daily ceilings before pooling.
 * The hosted-key limiter currently scopes buckets to a billing actor and supports
 * only per-minute windows, so this integration cannot enforce Zeliq's aggregate
 * organization-wide hourly and daily quotas. Correct aggregate enforcement requires
 * a provider/key-scoped multi-window limiter rather than a lower per-workspace value.
 */
export function zeliqHosting<P>(options: ZeliqHostingOptions<P>): ToolHostingConfig<P> {
  return {
    envKeyPrefix: ZELIQ_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'zeliq',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        options.validateParams(params)
        assertAcceptedSubmission(output)
        return {
          cost: options.estimatedCredits * ZELIQ_CREDIT_USD,
          metadata: {
            credits: options.estimatedCredits,
            estimated: true,
            operation: options.operation,
            unitCostUsd: ZELIQ_CREDIT_USD,
            pricingSource: ZELIQ_PRICING_SOURCE_URL,
            pricingSourceDate: ZELIQ_PRICING_SOURCE_DATE,
            pricingBasis: ZELIQ_PRICING_BASIS,
            calculation: `${options.estimatedCredits} * (${ZELIQ_STARTER_MONTHLY_USD} / ${ZELIQ_STARTER_MONTHLY_CREDITS})`,
            assumption: ZELIQ_ASYNC_BILLING_ASSUMPTION,
          },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: ZELIQ_HOSTED_REQUESTS_PER_MINUTE,
    },
  }
}
