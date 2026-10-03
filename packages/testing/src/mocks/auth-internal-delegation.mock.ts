import { vi } from 'vitest'

/**
 * Mirrors `InvalidInternalDelegationBindingError` from `@/lib/auth/internal-delegation`: same
 * `name` and message, no constructor arguments. Exposed under the real export name by
 * {@link authInternalDelegationMock}, so `instanceof` against the mocked export matches.
 */
export class MockInvalidInternalDelegationBindingError extends Error {
  constructor() {
    super('Internal delegation no longer resolves to an active workflow execution')
    this.name = 'InvalidInternalDelegationBindingError'
  }
}

/**
 * Controllable mock functions for `@/lib/auth/internal-delegation`.
 * `mockBindInternalExecutorDelegation` is a bare `vi.fn()`; resolve the bound principal per test.
 *
 * @example
 * ```ts
 * import { authInternalDelegationMockFns } from '@sim/testing/mocks/auth-internal-delegation.mock'
 *
 * authInternalDelegationMockFns.mockBindInternalExecutorDelegation.mockResolvedValue(principal)
 * ```
 */
export const authInternalDelegationMockFns = {
  mockBindInternalExecutorDelegation: vi.fn(),
}

/**
 * Static mock module for `@/lib/auth/internal-delegation`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth/internal-delegation', () => authInternalDelegationMock)
 * ```
 */
export const authInternalDelegationMock = {
  InvalidInternalDelegationBindingError: MockInvalidInternalDelegationBindingError,
  bindInternalExecutorDelegation: authInternalDelegationMockFns.mockBindInternalExecutorDelegation,
}
