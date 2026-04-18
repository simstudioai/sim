import { vi } from 'vitest'

/**
 * Auth type constants matching `@/lib/auth/hybrid` AuthType. Included in
 * `hybridAuthMock.AuthType` so route code can reference `AuthType.SESSION` etc.
 */
const AuthTypeMock = {
  SESSION: 'session',
  API_KEY: 'api_key',
  INTERNAL_JWT: 'internal_jwt',
} as const

/**
 * Controllable mock functions for `@/lib/auth/hybrid`. Override per-test with
 * `hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce(...)`.
 */
export const hybridAuthMockFns = {
  mockCheckHybridAuth: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockCheckInternalAuth: vi.fn(),
}

/**
 * Static mock module for `@/lib/auth/hybrid`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)
 * ```
 */
export const hybridAuthMock = {
  AuthType: AuthTypeMock,
  checkHybridAuth: hybridAuthMockFns.mockCheckHybridAuth,
  checkSessionOrInternalAuth: hybridAuthMockFns.mockCheckSessionOrInternalAuth,
  checkInternalAuth: hybridAuthMockFns.mockCheckInternalAuth,
}
