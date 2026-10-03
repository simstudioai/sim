import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/utils/background`.
 *
 * `mockRunDetached` is a bare `vi.fn()`: detached work is NOT run unless a test opts in, e.g.
 * `mockRunDetached.mockImplementation((_label, work) => { void work() })`.
 *
 * @example
 * ```ts
 * import { backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
 *
 * expect(backgroundTaskMockFns.mockRunDetached).toHaveBeenCalledWith('label', expect.any(Function))
 * ```
 */
export const backgroundTaskMockFns = {
  mockRunDetached: vi.fn(),
}

/**
 * Static mock module for `@/lib/core/utils/background`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
 * ```
 */
export const backgroundTaskMock = {
  runDetached: backgroundTaskMockFns.mockRunDetached,
}
