import { vi } from 'vitest'

async function rejectUnexpectedCode({ code }: { code: string }): Promise<never> {
  throw new Error(`Unexpected isolated-vm code in test: ${code}`)
}

/**
 * Controllable mock functions for `@/lib/execution/isolated-vm`. Executor tests mock it because
 * the real sandbox acquires a Redis-backed lease, which the shared Redis mock answers as
 * over-limit. Count-driven loops never reach the sandbox, so by default any call throws: a test
 * whose code does reach it (a While condition, a Function block) must say what it resolves to.
 *
 * @example
 * ```ts
 * isolatedVmMockFns.mockExecuteInIsolatedVM.mockResolvedValue({ result: userConditionResult })
 * ```
 */
export const isolatedVmMockFns = {
  /** Untyped like a bare `vi.fn()`, so each test resolves the fields its code path reads. */
  mockExecuteInIsolatedVM: vi.fn().mockImplementation(rejectUnexpectedCode),
}

/**
 * Static mock module for `@/lib/execution/isolated-vm`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/isolated-vm', () => isolatedVmMock)
 * ```
 */
export const isolatedVmMock = {
  executeInIsolatedVM: isolatedVmMockFns.mockExecuteInIsolatedVM,
}

/** Restores the default implementation, which rejects every call. */
export function resetIsolatedVmMock(): void {
  isolatedVmMockFns.mockExecuteInIsolatedVM.mockReset().mockImplementation(rejectUnexpectedCode)
}
