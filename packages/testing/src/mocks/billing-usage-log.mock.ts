import { vi } from 'vitest'

const COPILOT_USAGE_SOURCES = ['copilot', 'workspace-chat', 'mcp_copilot', 'mothership_block']
const UNBILLED_USAGE_CATEGORIES = ['model_unbilled'] as const
const CUMULATIVE_COST_EPSILON = 1e-9
const UNKNOWN_CURSOR_MESSAGE =
  'cursor does not identify a usage event. Restart pagination without a cursor; a cursor is only valid against the ledger it was issued from.'

/**
 * Stand-in for `CumulativeUsageContextMismatchError` with the real `name`, constructor args,
 * `eventKey`/`mismatchedFields` fields, and message. `instanceof` checks against the mocked
 * export match it.
 */
export class MockCumulativeUsageContextMismatchError extends Error {
  constructor(
    readonly eventKey: string,
    readonly mismatchedFields: readonly string[]
  ) {
    super(
      `Cumulative usage event "${eventKey}" is already bound to a different billing context (${mismatchedFields.join(', ')})`
    )
    this.name = 'CumulativeUsageContextMismatchError'
  }
}

/**
 * Stand-in for `UnknownUsageCursorError` with the real `name`, message, and `statusCode` 400.
 * It is NOT a subclass of the real `HttpError`, and its `cause` is a plain `Error` carrying
 * `code: 'validation'` rather than an `OrchestrationError`.
 */
export class MockUnknownUsageCursorError extends Error {
  readonly statusCode = 400

  constructor() {
    super(UNKNOWN_CURSOR_MESSAGE, {
      cause: Object.assign(new Error(UNKNOWN_CURSOR_MESSAGE), { code: 'validation' }),
    })
    this.name = 'UnknownUsageCursorError'
  }
}

function isUnbilledUsageCategory(category: string): boolean {
  return (UNBILLED_USAGE_CATEGORIES as readonly string[]).includes(category)
}

function resolveCumulativeTopUp(
  recordedCost: number,
  incomingCost: number
): { shouldBill: boolean; delta: number; newTotal: number } {
  if (incomingCost <= recordedCost + CUMULATIVE_COST_EPSILON) {
    return { shouldBill: false, delta: 0, newTotal: recordedCost }
  }
  return { shouldBill: true, delta: incomingCost - recordedCost, newTotal: incomingCost }
}

/**
 * Controllable mock functions for `@/lib/billing/core/usage-log`.
 *
 * Ledger reads and writes (`recordUsage`, `recordCumulativeUsage`, `getBillingPeriod*`,
 * `getStampedPeriodRangeUsageCostByUser`, `getUsageCreditsByLogId`, `get*UsageLogs`) are bare
 * `vi.fn()` (resolve/return `undefined`), which covers fire-and-forget `recordUsage` callers.
 * `deriveBillingContext` and `stableEventKey` are bare too (the real ones read the subscription
 * period and hash with SHA-256). Pure defaults: `isUnbilledUsageCategory` and
 * `resolveCumulativeTopUp` port the real logic.
 *
 * @example
 * ```ts
 * import { billingUsageLogMockFns } from '@sim/testing/mocks/billing-usage-log.mock'
 *
 * billingUsageLogMockFns.mockGetBillingPeriodUsageCost.mockResolvedValue(12.5)
 * ```
 */
export const billingUsageLogMockFns = {
  mockIsUnbilledUsageCategory: vi.fn(isUnbilledUsageCategory),
  mockStableEventKey: vi.fn(),
  mockDeriveBillingContext: vi.fn(),
  mockGetBillingPeriodUsageCost: vi.fn(),
  mockGetBillingPeriodWorkflowRunCount: vi.fn(),
  mockGetBillingPeriodUsageCostWithSourceSubset: vi.fn(),
  mockGetBillingPeriodUsageCostByUser: vi.fn(),
  mockGetStampedPeriodRangeUsageCostByUser: vi.fn(),
  mockRecordUsage: vi.fn(),
  mockResolveCumulativeTopUp: vi.fn(resolveCumulativeTopUp),
  mockRecordCumulativeUsage: vi.fn(),
  mockGetUsageCreditsByLogId: vi.fn(),
  mockGetUserUsageLogs: vi.fn(),
  mockGetBillingEntityUsageLogs: vi.fn(),
  mockGetWorkspaceUsageLogs: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/usage-log`. Constants carry the real values;
 * `CumulativeUsageContextMismatchError` is {@link MockCumulativeUsageContextMismatchError} and
 * `UnknownUsageCursorError` is {@link MockUnknownUsageCursorError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/usage-log', () => billingUsageLogMock)
 * ```
 */
export const billingUsageLogMock = {
  COPILOT_USAGE_SOURCES,
  UNBILLED_USAGE_CATEGORIES,
  CUMULATIVE_COST_EPSILON,
  UNKNOWN_CURSOR_MESSAGE,
  CumulativeUsageContextMismatchError: MockCumulativeUsageContextMismatchError,
  UnknownUsageCursorError: MockUnknownUsageCursorError,
  isUnbilledUsageCategory: billingUsageLogMockFns.mockIsUnbilledUsageCategory,
  stableEventKey: billingUsageLogMockFns.mockStableEventKey,
  deriveBillingContext: billingUsageLogMockFns.mockDeriveBillingContext,
  getBillingPeriodUsageCost: billingUsageLogMockFns.mockGetBillingPeriodUsageCost,
  getBillingPeriodWorkflowRunCount: billingUsageLogMockFns.mockGetBillingPeriodWorkflowRunCount,
  getBillingPeriodUsageCostWithSourceSubset:
    billingUsageLogMockFns.mockGetBillingPeriodUsageCostWithSourceSubset,
  getBillingPeriodUsageCostByUser: billingUsageLogMockFns.mockGetBillingPeriodUsageCostByUser,
  getStampedPeriodRangeUsageCostByUser:
    billingUsageLogMockFns.mockGetStampedPeriodRangeUsageCostByUser,
  recordUsage: billingUsageLogMockFns.mockRecordUsage,
  resolveCumulativeTopUp: billingUsageLogMockFns.mockResolveCumulativeTopUp,
  recordCumulativeUsage: billingUsageLogMockFns.mockRecordCumulativeUsage,
  getUsageCreditsByLogId: billingUsageLogMockFns.mockGetUsageCreditsByLogId,
  getUserUsageLogs: billingUsageLogMockFns.mockGetUserUsageLogs,
  getBillingEntityUsageLogs: billingUsageLogMockFns.mockGetBillingEntityUsageLogs,
  getWorkspaceUsageLogs: billingUsageLogMockFns.mockGetWorkspaceUsageLogs,
}
