import { vi } from 'vitest'
import { authMockFns } from './auth.mock'

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
 * Default session-delegating implementation for `checkSessionOrInternalAuth`.
 * Mirrors the real function's session-auth path so tests that only mock
 * `getSession` (via `authMockFns.mockGetSession`) continue to work when the
 * hybrid module is globally mocked.
 */
const defaultCheckSessionOrInternalAuth = async () => {
  const session = await authMockFns.mockGetSession()
  if (session?.user?.id) {
    return {
      success: true,
      userId: session.user.id,
      userName: session.user.name,
      userEmail: session.user.email,
      authType: AuthTypeMock.SESSION,
    }
  }
  return { success: false, error: 'Unauthorized' }
}

/**
 * Controllable mock functions for `@/lib/auth/hybrid`. Override per-test with
 * `hybridAuthMockFns.mockCheckHybridAuth.mockResolvedValueOnce(...)`.
 */
export const hybridAuthMockFns = {
  mockCheckHybridAuth: vi.fn(defaultCheckSessionOrInternalAuth),
  mockCheckSessionOrInternalAuth: vi.fn(defaultCheckSessionOrInternalAuth),
  mockCheckInternalAuth: vi.fn(),
  mockHasExternalApiCredentials: vi.fn(() => false),
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
  hasExternalApiCredentials: hybridAuthMockFns.mockHasExternalApiCredentials,
}
