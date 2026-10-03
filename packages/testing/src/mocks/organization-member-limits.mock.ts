import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/organizations/member-limits`.
 *
 * Every function is a bare `vi.fn()` (returns `undefined`); set per-test results for the
 * reads (`getOrgMemberUsageLimit`, `getOrgMemberUsageForCurrentPeriod`, …).
 *
 * @example
 * ```ts
 * import { organizationMemberLimitsMockFns } from '@sim/testing/mocks/organization-member-limits.mock'
 *
 * organizationMemberLimitsMockFns.mockGetOrgMemberUsageLimit.mockResolvedValue(50)
 * ```
 */
export const organizationMemberLimitsMockFns = {
  mockIsOrgMemberUsageLimitTarget: vi.fn(),
  mockGetOrgMemberUsageLimit: vi.fn(),
  mockSetOrgMemberUsageLimit: vi.fn(),
  mockGetOrgMemberUsageForBillingPeriod: vi.fn(),
  mockGetOrgMemberUsageForCurrentPeriod: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/organizations/member-limits`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/organizations/member-limits', () => organizationMemberLimitsMock)
 * ```
 */
export const organizationMemberLimitsMock = {
  isOrgMemberUsageLimitTarget: organizationMemberLimitsMockFns.mockIsOrgMemberUsageLimitTarget,
  getOrgMemberUsageLimit: organizationMemberLimitsMockFns.mockGetOrgMemberUsageLimit,
  setOrgMemberUsageLimit: organizationMemberLimitsMockFns.mockSetOrgMemberUsageLimit,
  getOrgMemberUsageForBillingPeriod:
    organizationMemberLimitsMockFns.mockGetOrgMemberUsageForBillingPeriod,
  getOrgMemberUsageForCurrentPeriod:
    organizationMemberLimitsMockFns.mockGetOrgMemberUsageForCurrentPeriod,
}
