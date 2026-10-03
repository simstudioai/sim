import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/providers`.
 *
 * `mockExecuteProviderRequest` is a bare `vi.fn()` (resolves `undefined` when awaited); set the
 * provider response per test.
 *
 * @example
 * ```ts
 * import { providersMockFns } from '@sim/testing/mocks/providers.mock'
 *
 * providersMockFns.mockExecuteProviderRequest.mockResolvedValue({ content: 'ok', model: 'gpt-4o' })
 * ```
 */
export const providersMockFns = {
  mockExecuteProviderRequest: vi.fn(),
}

/**
 * Static mock module for `@/providers`.
 *
 * `MAX_TOOL_ITERATIONS` carries the real default (`20`, used when the `MAX_TOOL_ITERATIONS` env var
 * is unset). It is a plain data property, so a suite that needs a different cap either spreads the
 * mock in its factory — `vi.mock('@/providers', () => ({ ...providersMock, MAX_TOOL_ITERATIONS: 5 }))`,
 * which works even for code that reads the value at import time — or assigns
 * `providersMock.MAX_TOOL_ITERATIONS = 5` at module scope / in `beforeEach` (provider tool loops read
 * the binding at call time, so the new value is seen; the object is fresh per test file, but a
 * per-test assignment persists to later tests in the same file).
 *
 * @example
 * ```ts
 * vi.mock('@/providers', () => providersMock)
 * ```
 */
export const providersMock: {
  MAX_TOOL_ITERATIONS: number
  executeProviderRequest: typeof providersMockFns.mockExecuteProviderRequest
} = {
  MAX_TOOL_ITERATIONS: 20,
  executeProviderRequest: providersMockFns.mockExecuteProviderRequest,
}
