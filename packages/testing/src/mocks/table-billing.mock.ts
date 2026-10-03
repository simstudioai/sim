import { vi } from 'vitest'

/**
 * Stand-in for `TableRowLimitError` from `@/lib/table/billing`: same `name`, `code: 'validation'`,
 * `limit` field and message. It extends `Error`, not the real `OrchestrationError`, so code under
 * test that checks `instanceof OrchestrationError` will not match it; classifiers reading `.code` do.
 */
export class MockTableRowLimitError extends Error {
  readonly code = 'validation' as const

  constructor(readonly limit: number) {
    super(
      `This table has reached its row limit (${limit.toLocaleString('en-US')} rows) on your current plan.`
    )
    this.name = 'TableRowLimitError'
  }
}

/**
 * Controllable mock functions for `@/lib/table/billing`.
 *
 * Defaults: `wouldExceedRowLimit` is the real pure comparison (`limit >= 0 && current + added >
 * limit`), `notifyTableRowUsage` and `invalidateWorkspaceTableLimitsCache` are no-ops. The limit
 * loaders (`getWorkspaceTableLimits`, `getMaxRowsPerTable`, `assertRowCapacity`) are bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { tableBillingMockFns } from '@sim/testing/mocks/table-billing.mock'
 *
 * tableBillingMockFns.mockGetWorkspaceTableLimits.mockResolvedValue({ maxTables: 10, maxRowsPerTable: 100 })
 * ```
 */
export const tableBillingMockFns = {
  mockNotifyTableRowUsage: vi.fn((_params: unknown): void => {}),
  mockInvalidateWorkspaceTableLimitsCache: vi.fn((_workspaceId: string): void => {}),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockWouldExceedRowLimit: vi.fn(
    (limit: number, currentRowCount: number, addedRows: number): boolean =>
      limit >= 0 && currentRowCount + addedRows > limit
  ),
  mockAssertRowCapacity: vi.fn(),
  mockGetMaxRowsPerTable: vi.fn(),
}

/**
 * Static mock module for `@/lib/table/billing`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/billing', () => tableBillingMock)
 * ```
 */
export const tableBillingMock = {
  TableRowLimitError: MockTableRowLimitError,
  notifyTableRowUsage: tableBillingMockFns.mockNotifyTableRowUsage,
  invalidateWorkspaceTableLimitsCache: tableBillingMockFns.mockInvalidateWorkspaceTableLimitsCache,
  getWorkspaceTableLimits: tableBillingMockFns.mockGetWorkspaceTableLimits,
  wouldExceedRowLimit: tableBillingMockFns.mockWouldExceedRowLimit,
  assertRowCapacity: tableBillingMockFns.mockAssertRowCapacity,
  getMaxRowsPerTable: tableBillingMockFns.mockGetMaxRowsPerTable,
}
