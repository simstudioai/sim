import { vi } from 'vitest'
import { getPlanPricing } from './billing-plan-logic'

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
