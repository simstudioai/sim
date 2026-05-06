import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/execution/preprocessing`.
 * Default is a bare `vi.fn()` — configure per-test.
 *
 * @example
 * ```ts
 * import { executionPreprocessingMockFns } from '@sim/testing'
 *
 * executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
 *   success: true,
 *   actorUserId: 'user-1',
 * })
 * ```
 */
export const executionPreprocessingMockFns = {
  mockPreprocessExecution: vi.fn(),
}

/**
 * Static mock module for `@/lib/execution/preprocessing`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
 * ```
 */
export const executionPreprocessingMock = {
  preprocessExecution: executionPreprocessingMockFns.mockPreprocessExecution,
}
