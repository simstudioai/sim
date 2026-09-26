import { vi } from 'vitest'

/**
 * Controllable mock functions for `@sim/utils/helpers`.
 *
 * Defaults:
 * - `mockSleep` and `mockInterruptibleSleep` resolve immediately (no timer), which is what every
 *   local stub did.
 * - `mockChunkArray` is the real implementation (throws on a non-positive-integer size).
 *
 * `noop` is exported on the module as the real no-op, not a `vi.fn()`.
 *
 * @example
 * ```ts
 * import { utilsHelpersMockFns } from '@sim/testing/mocks/utils-helpers.mock'
 *
 * expect(utilsHelpersMockFns.mockSleep).toHaveBeenCalledWith(1000)
 * ```
 */
export const utilsHelpersMockFns = {
  mockSleep: vi.fn(async (_ms: number): Promise<void> => {}),
  mockInterruptibleSleep: vi.fn(async (_ms: number, _signal?: AbortSignal): Promise<void> => {}),
  mockChunkArray: vi.fn(<T>(values: T[], size: number): T[][] => {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error('Chunk size must be a positive integer')
    }
    const chunks: T[][] = []
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size))
    }
    return chunks
  }),
}

/**
 * Static mock module for `@sim/utils/helpers`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/utils/helpers', () => utilsHelpersMock)
 * ```
 */
export const utilsHelpersMock = {
  sleep: utilsHelpersMockFns.mockSleep,
  interruptibleSleep: utilsHelpersMockFns.mockInterruptibleSleep,
  noop: () => {},
  chunkArray: utilsHelpersMockFns.mockChunkArray,
}
