import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/table/trigger`.
 *
 * Default: `fireTableTrigger` resolves `undefined` (a fire-and-forget no-op).
 *
 * @example
 * ```ts
 * import { tableTriggerMockFns } from '@sim/testing/mocks/table-trigger.mock'
 *
 * expect(tableTriggerMockFns.mockFireTableTrigger).toHaveBeenCalledWith('table-1', 'ws-1', 'Leads', 'insert', ...)
 * ```
 */
export const tableTriggerMockFns = {
  mockFireTableTrigger: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
}

/**
 * Static mock module for `@/lib/table/trigger`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/table/trigger', () => tableTriggerMock)
 * ```
 */
export const tableTriggerMock = {
  fireTableTrigger: tableTriggerMockFns.mockFireTableTrigger,
}
