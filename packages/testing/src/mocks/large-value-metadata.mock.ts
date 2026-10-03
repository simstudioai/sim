import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/execution/payloads/large-value-metadata`.
 *
 * Bare `vi.fn()` except:
 * - `mockCollectLargeValueReferenceKeys` returns `[]` (neutral; NOT a port of the real traversal).
 * - `mockReplaceLargeValueReferenceKeysWithClient`, `mockAddLargeValueReference`,
 *   `mockMarkLargeValuesDeleted` resolve `undefined` (async no-ops).
 * - `mockPruneLargeValueMetadata` resolves `{ referencesDeleted: 0, dependenciesDeleted: 0,
 *   tombstonesDeleted: 0 }` (the real empty result).
 *
 * `mockRegisterLargeValueOwner` stays bare (resolves `undefined`); tests that depend on the
 * registration outcome set `mockResolvedValue(true)` / `(false)`.
 *
 * @example
 * ```ts
 * import { largeValueMetadataMockFns } from '@sim/testing/mocks/large-value-metadata.mock'
 *
 * largeValueMetadataMockFns.mockRegisterLargeValueOwner.mockResolvedValue(true)
 * ```
 */
export const largeValueMetadataMockFns = {
  mockCollectLargeValueReferenceKeys: vi.fn(
    (_value: unknown, _workspaceId?: string): string[] => []
  ),
  mockRegisterLargeValueOwner: vi.fn(),
  mockReplaceLargeValueReferenceKeysWithClient: vi.fn(
    async (..._args: unknown[]): Promise<void> => {}
  ),
  mockAddLargeValueReference: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockMarkLargeValuesDeleted: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockPruneLargeValueMetadata: vi.fn(async (..._args: unknown[]) => ({
    referencesDeleted: 0,
    dependenciesDeleted: 0,
    tombstonesDeleted: 0,
  })),
  mockUnreferencedLargeValuePredicate: vi.fn(),
}

/**
 * Static mock module for `@/lib/execution/payloads/large-value-metadata`. Constants carry the real
 * values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/payloads/large-value-metadata', () => largeValueMetadataMock)
 * ```
 */
export const largeValueMetadataMock = {
  MAX_LARGE_VALUE_REFERENCES_PER_SCOPE: 5_000,
  LIVE_PAUSED_REFERENCE_STATUSES: ['paused', 'partially_resumed', 'cancelling'] as const,
  collectLargeValueReferenceKeys: largeValueMetadataMockFns.mockCollectLargeValueReferenceKeys,
  registerLargeValueOwner: largeValueMetadataMockFns.mockRegisterLargeValueOwner,
  replaceLargeValueReferenceKeysWithClient:
    largeValueMetadataMockFns.mockReplaceLargeValueReferenceKeysWithClient,
  addLargeValueReference: largeValueMetadataMockFns.mockAddLargeValueReference,
  markLargeValuesDeleted: largeValueMetadataMockFns.mockMarkLargeValuesDeleted,
  pruneLargeValueMetadata: largeValueMetadataMockFns.mockPruneLargeValueMetadata,
  unreferencedLargeValuePredicate: largeValueMetadataMockFns.mockUnreferencedLargeValuePredicate,
}
