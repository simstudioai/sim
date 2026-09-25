import { vi } from 'vitest'

/**
 * Mirrors `InvalidInternalDelegationTokenError` from `@/lib/auth/internal`: same `name`, default
 * message and optional message argument. Exposed under the real export name by
 * {@link authInternalMock}, so `instanceof` against the mocked export matches.
 */
export class MockInvalidInternalDelegationTokenError extends Error {
  constructor(message = 'Invalid internal delegation token') {
    super(message)
    this.name = 'InvalidInternalDelegationTokenError'
  }
}

/**
 * Controllable mock functions for `@/lib/auth/internal`.
 *
 * Defaults:
 * - `mockGenerateInternalToken` resolves `'internal-token'`.
 * - `mockVerifyCronAuth` returns `null` (the request is authorized).
 *
 * `mockGenerateInternalDelegationToken`, `mockVerifyInternalDelegationToken` and
 * `mockVerifyInternalToken` are bare `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
 *
 * authInternalMockFns.mockVerifyCronAuth.mockReturnValue(
 *   new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
 * )
 * ```
 */
export const authInternalMockFns = {
  mockGenerateInternalToken: vi.fn(
    async (_userId?: string, _claims?: unknown): Promise<string> => 'internal-token'
  ),
  mockGenerateInternalDelegationToken: vi.fn(),
  mockVerifyInternalDelegationToken: vi.fn(),
  mockVerifyInternalToken: vi.fn(),
  mockVerifyCronAuth: vi.fn((_request: unknown, _context?: string): unknown => null),
}

/**
 * Static mock module for `@/lib/auth/internal`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth/internal', () => authInternalMock)
 * ```
 */
export const authInternalMock = {
  InvalidInternalDelegationTokenError: MockInvalidInternalDelegationTokenError,
  generateInternalToken: authInternalMockFns.mockGenerateInternalToken,
  generateInternalDelegationToken: authInternalMockFns.mockGenerateInternalDelegationToken,
  verifyInternalDelegationToken: authInternalMockFns.mockVerifyInternalDelegationToken,
  verifyInternalToken: authInternalMockFns.mockVerifyInternalToken,
  verifyCronAuth: authInternalMockFns.mockVerifyCronAuth,
}
