import { vi } from 'vitest'

/** Faithful port of the real `getPlanPricing` (re-exported from `@/lib/billing/subscriptions/utils`) with env overrides unset. */
function getPlanPricing(plan: string): { basePrice: number } {
  if (!plan || plan === 'free') return { basePrice: 0 }
  if (plan === 'enterprise') return { basePrice: 200 }
  const isPro = plan === 'pro' || plan.startsWith('pro_')
  const isTeam = plan === 'team' || plan.startsWith('team_')
  if (isPro || isTeam) {
    const match = plan.match(/_(\d+)$/)
    const tierCredits = match
      ? Number.parseInt(match[1], 10)
      : plan === 'pro'
        ? 4000
        : plan === 'team'
          ? 8000
          : 0
    if (tierCredits > 0) return { basePrice: tierCredits / 200 }
    return { basePrice: isPro ? 20 : 40 }
  }
  return { basePrice: 0 }
}

/**
 * Controllable mock functions for `@/lib/billing/core/billing`.
 *
 * Every async lookup (`getOrganizationSubscription`, `isSubscriptionOrgScoped`,
 * `computeOrgOverageAmount`, `calculateSubscriptionOverage`, `getPersonalBillingSummary`) is a
 * bare `vi.fn()` (resolves `undefined`). `getPlanPricing` defaults to the real pure logic
 * (free 0, enterprise 200, tiered plans `credits / 200`, legacy pro 20 / team 40).
 *
 * @example
 * ```ts
 * import { billingCoreMockFns } from '@sim/testing/mocks/billing-core.mock'
 *
 * billingCoreMockFns.mockGetOrganizationSubscription.mockResolvedValue({ plan: 'team', seats: 5 })
 * ```
 */
export const billingCoreMockFns = {
  mockGetPlanPricing: vi.fn(getPlanPricing),
  mockGetOrganizationSubscription: vi.fn(),
  mockIsSubscriptionOrgScoped: vi.fn(),
  mockComputeOrgOverageAmount: vi.fn(),
  mockCalculateSubscriptionOverage: vi.fn(),
  mockGetPersonalBillingSummary: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/billing`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/billing', () => billingCoreMock)
 * ```
 */
export const billingCoreMock = {
  getPlanPricing: billingCoreMockFns.mockGetPlanPricing,
  getOrganizationSubscription: billingCoreMockFns.mockGetOrganizationSubscription,
  isSubscriptionOrgScoped: billingCoreMockFns.mockIsSubscriptionOrgScoped,
  computeOrgOverageAmount: billingCoreMockFns.mockComputeOrgOverageAmount,
  calculateSubscriptionOverage: billingCoreMockFns.mockCalculateSubscriptionOverage,
  getPersonalBillingSummary: billingCoreMockFns.mockGetPersonalBillingSummary,
}
