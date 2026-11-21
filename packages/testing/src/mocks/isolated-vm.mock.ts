import { vi } from 'vitest'

/**
 * Runs the request's code as plain JavaScript in the test process. The real
 * `executeInIsolatedVM` leases an isolate through Redis, which unit tests do not have; for the
 * executor's own checks (a loop's `return Boolean(<index> < <count>)` continuation, a condition's
 * expression) plain evaluation gives the same answer.
 */
async function runAsPlainJavaScript({ code }: { code: string }): Promise<{ result: unknown }> {
  return { result: new Function(code)() }
}

/**
 * Controllable mock functions for `@/lib/execution/isolated-vm`. `mockExecuteInIsolatedVM`
 * defaults to plain evaluation; a test that drives isolate results itself overrides it. It is a
 * bare `vi.fn()` given that default, like `toolsMockFns.mockExecuteTool`, so tests read its calls
 * without restating the request type.
 *
 * @example
 * ```ts
 * isolatedVmMockFns.mockExecuteInIsolatedVM.mockResolvedValueOnce({ result: false })
 * ```
 */
export const isolatedVmMockFns = {
  mockExecuteInIsolatedVM: vi.fn().mockImplementation(runAsPlainJavaScript),
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
