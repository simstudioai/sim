import type { ToolHostingConfig } from '@/tools/types'

export const FORAGER_API_KEY_PREFIX = 'FORAGER_API_KEY'
export const FORAGER_PLAN_PRICING_SOURCE_URL = 'https://www.forager.ai/pricing'
export const FORAGER_ENDPOINT_PRICING_SOURCE_URL =
  'https://docs.forager.ai/api-overview/credit-pricing'
export const FORAGER_PRICING_VERIFIED_ON = '2026-08-26'
export const FORAGER_PRICING_EXCLUSIONS = [
  'free allowance',
  'annual commitment discount',
  'custom Enterprise plan',
] as const

/**
 * Hosted Forager billing basis, verified 2026-08-26.
 *
 * The lowest recurring self-serve paid API plan published by Forager is Starter monthly:
 * $50 for 2,250 API credits. Annual billing is excluded because it requires a longer commitment;
 * the free allowance and custom Enterprise plan are excluded because neither is a sustainable,
 * generally purchasable recurring unit price. Therefore one credit costs $50 / 2,250 = 1 / 45
 * USD, or approximately $0.022222222222222223.
 *
 * Plan source: https://www.forager.ai/pricing
 * Endpoint credit source: https://docs.forager.ai/api-overview/credit-pricing
 */
export const FORAGER_CREDIT_USD = 50 / 2250

/**
 * Forager publishes no numeric ceiling for enrichment and search endpoints. Ten requests per
 * minute per workspace is Sim's deliberately conservative internal safety limit for the shared
 * hosted-key pool, not a claim about Forager's provider-side rate limit.
 * OpenAPI source checked 2026-08-26: https://docs.forager.ai/_spec/openapi.json?download=
 */
export const FORAGER_HOSTED_REQUESTS_PER_MINUTE = 10

export const FORAGER_PRICING_BASIS = {
  jobSearch: 'Official Forager credit table: Job Search API call = 2 credits',
  jobSearchTotals:
    'Explicit estimate: Job Search Totals uses the same search contract and infrastructure as Job Search, so it is billed at the documented Job Search API call rate of 2 credits',
  organizationSearch: 'Official Forager credit table: Organization Search API call = 1 credit',
  organizationSearchTotals:
    'Explicit estimate: Organization Search Totals uses the same search contract and infrastructure as Organization Search, so it is billed at the documented Organization Search API call rate of 1 credit',
  personalEmail:
    'Official Forager credit table: Personal Email = 5 credits; zero when the documented successful response is empty',
  phoneNumber:
    'Official Forager credit table: Phone = 15 credits; zero is assumed when no phone record is returned',
  workEmail:
    'Official Forager credit table: Work Email = 5 credits; zero is assumed when no email record is returned',
  personDetail: 'Official Forager credit table: Person Details = 1 credit',
  reverseEmail: 'Official Forager credit table: Reverse Email = 5 credits',
  reversePhone: 'Official Forager credit table: Reverse Phone = 15 credits',
  personRoleSearch: 'Official Forager credit table: Person Role Search API call = 1 credit',
  personRoleSearchTotals:
    'Explicit estimate: Person Role Search Totals uses the same search contract and infrastructure as Person Role Search, so it is billed at the documented Person Role Search API call rate of 1 credit',
  websiteDetail:
    'Explicit mapping: Website Detail Lookup returns website_technologies and is billed at the official Organization Technologies Lookup rate of 1 credit',
} as const

export function foragerHosting<P>(
  getCredits: (params: P, output: Record<string, unknown>) => number,
  pricingBasis: string
): ToolHostingConfig<P> {
  return {
    envKeyPrefix: FORAGER_API_KEY_PREFIX,
    apiKeyParam: 'apiKey',
    byokProviderId: 'forager',
    pricing: {
      type: 'custom',
      getCost: (params, output) => {
        const credits = getCredits(params, output)
        if (!Number.isInteger(credits) || credits < 0) {
          throw new Error('Forager credit calculation returned an invalid credit count')
        }
        return {
          cost: credits * FORAGER_CREDIT_USD,
          metadata: {
            credits,
            creditUsd: FORAGER_CREDIT_USD,
            pricingBasis,
            planPricingSource: FORAGER_PLAN_PRICING_SOURCE_URL,
            endpointPricingSource: FORAGER_ENDPOINT_PRICING_SOURCE_URL,
            pricingVerifiedOn: FORAGER_PRICING_VERIFIED_ON,
          },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: FORAGER_HOSTED_REQUESTS_PER_MINUTE,
    },
  }
}

export function fixedForagerCredits<P>(
  credits: number,
  pricingBasis: string
): ToolHostingConfig<P> {
  return foragerHosting(() => credits, pricingBasis)
}

export function successfulArrayForagerCredits<P>(
  outputKey: string,
  credits: number,
  pricingBasis: string
): ToolHostingConfig<P> {
  return foragerHosting((_params, output) => {
    const results = output[outputKey]
    if (!Array.isArray(results)) {
      throw new Error(
        `Forager response missing ${outputKey} array; hosted billing cannot determine cost`
      )
    }
    return results.length > 0 ? credits : 0
  }, pricingBasis)
}
