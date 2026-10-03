import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/calculations/usage-monitor`.
 *
 * Every export is async and a bare `vi.fn()` (resolves `undefined`); set the usage or block
 * result a test needs, e.g. `mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })`.
 *
 * @example
 * ```ts
 * import { billingUsageMonitorMockFns } from '@sim/testing/mocks/billing-usage-monitor.mock'
 *
 * billingUsageMonitorMockFns.mockCheckBillingBlocked.mockResolvedValue({ blocked: false })
 * ```
 */
export const billingUsageMonitorMockFns = {
  mockCheckUsageStatus: vi.fn(),
  mockCheckBillingBlocked: vi.fn(),
  mockCheckBillingEntityBlocked: vi.fn(),
  mockCheckServerSideUsageLimits: vi.fn(),
  mockCheckOrganizationMemberUsageLimit: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/calculations/usage-monitor`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/calculations/usage-monitor', () => billingUsageMonitorMock)
 * ```
 */
export const billingUsageMonitorMock = {
  checkUsageStatus: billingUsageMonitorMockFns.mockCheckUsageStatus,
  checkBillingBlocked: billingUsageMonitorMockFns.mockCheckBillingBlocked,
  checkBillingEntityBlocked: billingUsageMonitorMockFns.mockCheckBillingEntityBlocked,
  checkServerSideUsageLimits: billingUsageMonitorMockFns.mockCheckServerSideUsageLimits,
  checkOrganizationMemberUsageLimit:
    billingUsageMonitorMockFns.mockCheckOrganizationMemberUsageLimit,
  checkActorUsageLimits: billingUsageMonitorMockFns.mockCheckActorUsageLimits,
}
