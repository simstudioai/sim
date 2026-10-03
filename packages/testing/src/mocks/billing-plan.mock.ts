import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/plan`.
 *
 * Both lookups are bare `vi.fn()` (resolve `undefined`); set the subscription (or `null`) a
 * test needs per case.
 *
 * @example
 * ```ts
 * import { billingPlanMockFns } from '@sim/testing/mocks/billing-plan.mock'
 *
 * billingPlanMockFns.mockGetHighestPrioritySubscription.mockResolvedValue(null)
 * ```
 */
export const billingPlanMockFns = {
  mockGetHighestPriorityPersonalSubscription: vi.fn(),
  mockGetHighestPrioritySubscription: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/plan`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/plan', () => billingPlanMock)
 * ```
 */
export const billingPlanMock = {
  getHighestPriorityPersonalSubscription:
    billingPlanMockFns.mockGetHighestPriorityPersonalSubscription,
  getHighestPrioritySubscription: billingPlanMockFns.mockGetHighestPrioritySubscription,
}
