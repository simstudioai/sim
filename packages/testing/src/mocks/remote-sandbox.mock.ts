import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/execution/remote-sandbox`.
 * Every function is a bare `vi.fn()` (resolves `undefined`); `withPiSandbox` does NOT invoke its
 * callback by default — give it a runner per-test.
 *
 * @example
 * ```ts
 * import { remoteSandboxMockFns } from '@sim/testing/mocks/remote-sandbox.mock'
 *
 * remoteSandboxMockFns.mockWithPiSandbox.mockImplementation(async (_options, fn) =>
 *   fn({ run: mockRun, writeFile: mockWriteFile })
 * )
 * ```
 */
export const remoteSandboxMockFns = {
  mockExecuteInSandbox: vi.fn(),
  mockExecuteShellInSandbox: vi.fn(),
  mockWithPiSandbox: vi.fn(),
}

/**
 * Static mock module for `@/lib/execution/remote-sandbox`. `SIM_RESULT_PREFIX` carries the real value.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)
 * ```
 */
export const remoteSandboxMock = {
  SIM_RESULT_PREFIX: '__SIM_RESULT__=',
  executeInSandbox: remoteSandboxMockFns.mockExecuteInSandbox,
  executeShellInSandbox: remoteSandboxMockFns.mockExecuteShellInSandbox,
  withPiSandbox: remoteSandboxMockFns.mockWithPiSandbox,
}
