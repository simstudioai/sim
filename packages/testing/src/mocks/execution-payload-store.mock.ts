import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/execution/payloads/store`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { executionPayloadStoreMockFns } from '@sim/testing/mocks/execution-payload-store.mock'
 *
 * executionPayloadStoreMockFns.mockMaterializeLargeValueRef.mockResolvedValue({ ok: true })
 * ```
 */
export const executionPayloadStoreMockFns = {
  mockStoreLargeValue: vi.fn(),
  mockStoreExecutionTraceArchive: vi.fn(),
  mockMaterializeLargeValueRef: vi.fn(),
}

/**
 * Static mock module for `@/lib/execution/payloads/store`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/payloads/store', () => executionPayloadStoreMock)
 * ```
 */
export const executionPayloadStoreMock = {
  storeLargeValue: executionPayloadStoreMockFns.mockStoreLargeValue,
  storeExecutionTraceArchive: executionPayloadStoreMockFns.mockStoreExecutionTraceArchive,
  materializeLargeValueRef: executionPayloadStoreMockFns.mockMaterializeLargeValueRef,
}
