import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/ttl-availability`.
 *
 * Defaults: `isTableRowTtlEnabled` resolves `false` (the flag is off), `assertTableRowTtlEnabled`
 * resolves `undefined` (the gate passes). The two are independent: flipping one does not affect
 * the other.
 *
 * @example
 * ```ts
 * import { tableTtlAvailabilityMockFns } from '@sim/testing/mocks/table-ttl-availability.mock'
 *
 * tableTtlAvailabilityMockFns.mockIsTableRowTtlEnabled.mockResolvedValue(true)
 * ```
 */
export const tableTtlAvailabilityMockFns = {
  mockIsTableRowTtlEnabled: vi.fn(async (): Promise<boolean> => false),
  mockAssertTableRowTtlEnabled: vi.fn(async (): Promise<void> => {}),
}

/**
 * Static mock module for `@/lib/table/ttl-availability`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/ttl-availability', () => tableTtlAvailabilityMock)
 * ```
 */
export const tableTtlAvailabilityMock = {
  isTableRowTtlEnabled: tableTtlAvailabilityMockFns.mockIsTableRowTtlEnabled,
  assertTableRowTtlEnabled: tableTtlAvailabilityMockFns.mockAssertTableRowTtlEnabled,
}
