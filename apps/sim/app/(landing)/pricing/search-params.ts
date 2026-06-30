import { createSearchParamsCache, parseAsStringLiteral } from 'nuqs/server'

/** Billing periods offered on the pricing page. */
export const BILLING_PERIODS = ['monthly', 'annual'] as const

/**
 * Co-located, typed URL query param for the pricing page's billing-period
 * toggle. Shared by the client cards (`useQueryStates`) and the server page
 * (`pricingSearchParamsCache`) so a shared `?billing=annual` URL is
 * server-rendered with the annual prices already applied (no toggle flash).
 */
export const pricingParsers = {
  billing: parseAsStringLiteral(BILLING_PERIODS).withDefault('monthly'),
}

/** Clean URLs, no back-stack churn — the toggle is a passive view switch. */
export const pricingUrlKeys = {
  history: 'replace',
  clearOnDefault: true,
} as const

export const pricingSearchParamsCache = createSearchParamsCache(pricingParsers)
