import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/organization`.
 *
 * Every export is a bare `vi.fn()` (resolves `undefined`); set the role or billing data a test
 * needs per case.
 *
 * @example
 * ```ts
 * import { billingOrganizationMockFns } from '@sim/testing/mocks/billing-organization.mock'
 *
 * billingOrganizationMockFns.mockIsOrganizationOwnerOrAdmin.mockResolvedValue(true)
 * ```
 */
export const billingOrganizationMockFns = {
  mockGetOrgMemberLedgerByUser: vi.fn(),
  mockGetOrganizationMemberUsageSnapshot: vi.fn(),
  mockGetOrganizationBillingData: vi.fn(),
  mockUpdateOrganizationUsageLimit: vi.fn(),
  mockIsOrganizationOwnerOrAdmin: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/organization`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/organization', () => billingOrganizationMock)
 * ```
 */
export const billingOrganizationMock = {
  getOrgMemberLedgerByUser: billingOrganizationMockFns.mockGetOrgMemberLedgerByUser,
  getOrganizationMemberUsageSnapshot:
    billingOrganizationMockFns.mockGetOrganizationMemberUsageSnapshot,
  getOrganizationBillingData: billingOrganizationMockFns.mockGetOrganizationBillingData,
  updateOrganizationUsageLimit: billingOrganizationMockFns.mockUpdateOrganizationUsageLimit,
  isOrganizationOwnerOrAdmin: billingOrganizationMockFns.mockIsOrganizationOwnerOrAdmin,
}
