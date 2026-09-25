import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/usage`.
 *
 * Every export is async and a bare `vi.fn()` (resolves `undefined`), which covers the
 * fire-and-forget callers of `syncUsageLimitsFromSubscription`, `ensureUserStatsExists`, and
 * `maybeSendUsageThresholdEmail`. Set limits and usage data per case.
 *
 * @example
 * ```ts
 * import { billingUsageMockFns } from '@sim/testing/mocks/billing-usage.mock'
 *
 * billingUsageMockFns.mockGetOrgUsageLimit.mockResolvedValue({ limit: 1000 })
 * ```
 */
export const billingUsageMockFns = {
  mockGetOrgLastPeriodCost: vi.fn(),
  mockGetOrgUsageLimit: vi.fn(),
  mockHandleNewUser: vi.fn(),
  mockEnsureUserStatsExists: vi.fn(),
  mockGetResolvedUserUsageData: vi.fn(),
  mockGetUserUsageData: vi.fn(),
  mockGetUserUsageLimitInfo: vi.fn(),
  mockUpdateUserUsageLimit: vi.fn(),
  mockGetUserUsageLimit: vi.fn(),
  mockCheckUsageStatus: vi.fn(),
  mockSyncUsageLimitsFromSubscription: vi.fn(),
  mockGetEffectiveCurrentPeriodCost: vi.fn(),
  mockMaybeSendUsageThresholdEmail: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/usage`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/usage', () => billingUsageMock)
 * ```
 */
export const billingUsageMock = {
  getOrgLastPeriodCost: billingUsageMockFns.mockGetOrgLastPeriodCost,
  getOrgUsageLimit: billingUsageMockFns.mockGetOrgUsageLimit,
  handleNewUser: billingUsageMockFns.mockHandleNewUser,
  ensureUserStatsExists: billingUsageMockFns.mockEnsureUserStatsExists,
  getResolvedUserUsageData: billingUsageMockFns.mockGetResolvedUserUsageData,
  getUserUsageData: billingUsageMockFns.mockGetUserUsageData,
  getUserUsageLimitInfo: billingUsageMockFns.mockGetUserUsageLimitInfo,
  updateUserUsageLimit: billingUsageMockFns.mockUpdateUserUsageLimit,
  getUserUsageLimit: billingUsageMockFns.mockGetUserUsageLimit,
  checkUsageStatus: billingUsageMockFns.mockCheckUsageStatus,
  syncUsageLimitsFromSubscription: billingUsageMockFns.mockSyncUsageLimitsFromSubscription,
  getEffectiveCurrentPeriodCost: billingUsageMockFns.mockGetEffectiveCurrentPeriodCost,
  maybeSendUsageThresholdEmail: billingUsageMockFns.mockMaybeSendUsageThresholdEmail,
}
