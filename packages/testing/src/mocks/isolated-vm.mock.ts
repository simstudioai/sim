import { vi } from 'vitest'

/** The continuation check the loop orchestrator compiles for count-driven loops. */
const LOOP_INDEX_CHECK = /^return Boolean\((\d+) < (\d+)\)$/

/**
 * Evaluates a loop's `return Boolean(<index> < <count>)` continuation check, or returns `null`
 * for any other code so a test can decide what that code resolves to.
 */
export function evaluateLoopIndexCheck(code: string): boolean | null {
  const match = LOOP_INDEX_CHECK.exec(code)
  return match ? Number(match[1]) < Number(match[2]) : null
}

async function executeLoopIndexCheck({ code }: { code: string }) {
  const result = evaluateLoopIndexCheck(code)
  if (result === null) throw new Error(`Unexpected isolated-vm code in test: ${code}`)
  return { result }
}

/**
 * Controllable mock functions for `@/lib/execution/isolated-vm`. Executor tests mock it because
 * the real sandbox acquires a Redis-backed lease, which the shared Redis mock answers as
 * over-limit. By default only loop continuation checks evaluate; any other code throws, so a
 * test that needs more must say what it resolves to.
 *
 * @example
 * ```ts
 * isolatedVmMockFns.mockExecuteInIsolatedVM.mockImplementation(async ({ code }) => ({
 *   result: evaluateLoopIndexCheck(code) ?? userConditionResult,
 * }))
 * ```
 */
export const isolatedVmMockFns = {
  /** Untyped like a bare `vi.fn()`, so each test resolves the fields its code path reads. */
  mockExecuteInIsolatedVM: vi.fn().mockImplementation(executeLoopIndexCheck),
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

/** Restores the default loop-check-only implementation. */
export function resetIsolatedVmMock(): void {
  isolatedVmMockFns.mockExecuteInIsolatedVM.mockReset().mockImplementation(executeLoopIndexCheck)
}
