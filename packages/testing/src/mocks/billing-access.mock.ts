import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/access`.
 *
 * All three are bare `vi.fn()` (resolve `undefined`). Tests of a non-blocked path usually set
 * `mockIsOrganizationBillingBlocked.mockResolvedValue(false)` and
 * `mockGetEffectiveBillingStatus.mockResolvedValue({ billingBlocked: false })`.
 *
 * @example
 * ```ts
 * import { billingAccessMockFns } from '@sim/testing/mocks/billing-access.mock'
 *
 * billingAccessMockFns.mockIsOrganizationBillingBlocked.mockResolvedValue(true)
 * ```
 */
export const billingAccessMockFns = {
  mockGetBillingEntityBlockStatus: vi.fn(),
  mockGetEffectiveBillingStatus: vi.fn(),
  mockIsOrganizationBillingBlocked: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/access`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/access', () => billingAccessMock)
 * ```
 */
export const billingAccessMock = {
  getBillingEntityBlockStatus: billingAccessMockFns.mockGetBillingEntityBlockStatus,
  getEffectiveBillingStatus: billingAccessMockFns.mockGetEffectiveBillingStatus,
  isOrganizationBillingBlocked: billingAccessMockFns.mockIsOrganizationBillingBlocked,
}
