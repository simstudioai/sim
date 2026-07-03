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

/**
 * Parsing this in the page's server component opts the route into dynamic
 * rendering, which populates `useSearchParams` during the server render — so the
 * client cards' `useQueryStates` resolves the billing period server-side and the
 * initial HTML ships the correct prices (no toggle flash on a shared link).
 */
export const pricingSearchParamsCache = createSearchParamsCache(pricingParsers)
