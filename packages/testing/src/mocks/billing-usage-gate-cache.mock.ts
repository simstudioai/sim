import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/usage-gate-cache`.
 *
 * The three `check*UsageLimits` gates are bare `vi.fn()` (resolve `undefined`); set
 * `mockResolvedValue({ isExceeded: false })` for an admitted path. `resetUsageGateCache` is a
 * no-op.
 *
 * @example
 * ```ts
 * import { billingUsageGateCacheMockFns } from '@sim/testing/mocks/billing-usage-gate-cache.mock'
 *
 * billingUsageGateCacheMockFns.mockCheckExecutionUsageLimits.mockResolvedValue({ isExceeded: false })
 * ```
 */
export const billingUsageGateCacheMockFns = {
  mockCheckIngestionUsageLimits: vi.fn(),
  mockCheckSearchUsageLimits: vi.fn(),
  mockCheckExecutionUsageLimits: vi.fn(),
  mockResetUsageGateCache: vi.fn((): void => {}),
}

/**
 * Static mock module for `@/lib/billing/core/usage-gate-cache`. Constants carry the real
 * values (`USAGE_GATE_SETTLE_TIMEOUT_MS` = 2 x the 60 s ledger statement timeout + 15 s).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/usage-gate-cache', () => billingUsageGateCacheMock)
 * ```
 */
export const billingUsageGateCacheMock = {
  USAGE_GATE_TTL_MS: 5 * 60 * 1000,
  USAGE_GATE_SETTLE_TIMEOUT_MS: 2 * 60_000 + 15_000,
  checkIngestionUsageLimits: billingUsageGateCacheMockFns.mockCheckIngestionUsageLimits,
  checkSearchUsageLimits: billingUsageGateCacheMockFns.mockCheckSearchUsageLimits,
  checkExecutionUsageLimits: billingUsageGateCacheMockFns.mockCheckExecutionUsageLimits,
  resetUsageGateCache: billingUsageGateCacheMockFns.mockResetUsageGateCache,
}
