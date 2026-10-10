import { vi } from 'vitest'

const mockApplyFileStorageDelta = vi.fn<(deltaBytes: number) => Promise<number>>(async () => 0)

/**
 * Stand-in for `StorageLimitExceededError` with the real `name`, constructor, and
 * `code: 'payload_too_large'`. It is NOT a subclass of the real `OrchestrationError`; a test
 * exercising an `instanceof OrchestrationError` branch must throw the real class.
 */
export class MockStorageLimitExceededError extends Error {
  readonly code = 'payload_too_large'

  constructor(message: string) {
    super(message)
    this.name = 'StorageLimitExceededError'
  }
}

/**
 * Controllable mock functions for `@/lib/billing/storage`.
 *
 * The file preparer returns a controllable signed mutation; other exports are bare `vi.fn()`
 * functions. Set the billing context, quota result, or limit a test needs per case.
 *
 * @example
 * ```ts
 * import { billingStorageMockFns } from '@sim/testing/mocks/billing-storage.mock'
 *
 * billingStorageMockFns.mockResolveStorageBillingContext.mockResolvedValue({ workspaceId: 'ws-1' })
 * billingStorageMockFns.mockCheckStorageQuotaForBillingContext.mockResolvedValue({ allowed: true })
 * ```
 */
export const billingStorageMockFns = {
  mockApplyFileStorageDelta,
  mockPrepareFileAccountingInTx: vi.fn(async () => ({
    billing: {},
    mutation: { applyDelta: mockApplyFileStorageDelta },
  })),
  mockResolveStorageBillingContext: vi.fn(),
  mockCheckStorageQuota: vi.fn(),
  mockCheckStorageQuotaForBillingContext: vi.fn(),
  mockGetStorageLimitForBillingContext: vi.fn(),
  mockGetStorageUsageForBillingContext: vi.fn(),
  mockGetUserStorageLimit: vi.fn(),
  mockGetUserStorageUsage: vi.fn(),
  mockApplyStorageUsageDeltasInTx: vi.fn(),
  mockCheckAndIncrementStorageUsageInTx: vi.fn(),
  mockDecrementStorageUsageForBillingContextInTx: vi.fn(),
  mockIncrementAdmittedStorageUsageForBillingContextInTx: vi.fn(),
  mockIncrementStorageUsageForBillingContextInTx: vi.fn(),
  mockMaybeNotifyStorageLimitForBillingContext: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/storage`.
 * `StorageLimitExceededError` is {@link MockStorageLimitExceededError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/storage', () => billingStorageMock)
 * ```
 */
export const billingStorageMock = {
  prepareFileAccountingInTx: billingStorageMockFns.mockPrepareFileAccountingInTx,
  StorageLimitExceededError: MockStorageLimitExceededError,
  resolveStorageBillingContext: billingStorageMockFns.mockResolveStorageBillingContext,
  checkStorageQuota: billingStorageMockFns.mockCheckStorageQuota,
  checkStorageQuotaForBillingContext: billingStorageMockFns.mockCheckStorageQuotaForBillingContext,
  getStorageLimitForBillingContext: billingStorageMockFns.mockGetStorageLimitForBillingContext,
  getStorageUsageForBillingContext: billingStorageMockFns.mockGetStorageUsageForBillingContext,
  getUserStorageLimit: billingStorageMockFns.mockGetUserStorageLimit,
  getUserStorageUsage: billingStorageMockFns.mockGetUserStorageUsage,
  applyStorageUsageDeltasInTx: billingStorageMockFns.mockApplyStorageUsageDeltasInTx,
  checkAndIncrementStorageUsageInTx: billingStorageMockFns.mockCheckAndIncrementStorageUsageInTx,
  decrementStorageUsageForBillingContextInTx:
    billingStorageMockFns.mockDecrementStorageUsageForBillingContextInTx,
  incrementAdmittedStorageUsageForBillingContextInTx:
    billingStorageMockFns.mockIncrementAdmittedStorageUsageForBillingContextInTx,
  incrementStorageUsageForBillingContextInTx:
    billingStorageMockFns.mockIncrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext:
    billingStorageMockFns.mockMaybeNotifyStorageLimitForBillingContext,
}
