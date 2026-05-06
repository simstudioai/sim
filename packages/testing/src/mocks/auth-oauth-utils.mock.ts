import { vi } from 'vitest'

/**
 * Mock of the `ServiceAccountTokenError` class from
 * `@/app/api/auth/oauth/utils`. Declared as a real class so consumer code
 * using `instanceof ServiceAccountTokenError` keeps working under mock.
 */
export class ServiceAccountTokenErrorMock extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorDescription: string
  ) {
    super(errorDescription)
    this.name = 'ServiceAccountTokenError'
  }
}

/**
 * Controllable mock functions for `@/app/api/auth/oauth/utils`.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { authOAuthUtilsMockFns } from '@sim/testing'
 *
 * authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
 * authOAuthUtilsMockFns.mockGetOAuthToken.mockResolvedValue(null)
 * ```
 */
export const authOAuthUtilsMockFns = {
  mockResolveOAuthAccountId: vi.fn(),
  mockGetServiceAccountToken: vi.fn(),
  mockSafeAccountInsert: vi.fn(),
  mockGetCredential: vi.fn(),
  mockGetOAuthToken: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockRefreshTokenIfNeeded: vi.fn(),
  mockGetCredentialsForCredentialSet: vi.fn(),
}

/**
 * Static mock module for `@/app/api/auth/oauth/utils`.
 *
 * @example
 * ```ts
 * vi.mock('@/app/api/auth/oauth/utils', () => authOAuthUtilsMock)
 * ```
 */
export const authOAuthUtilsMock = {
  ServiceAccountTokenError: ServiceAccountTokenErrorMock,
  resolveOAuthAccountId: authOAuthUtilsMockFns.mockResolveOAuthAccountId,
  getServiceAccountToken: authOAuthUtilsMockFns.mockGetServiceAccountToken,
  safeAccountInsert: authOAuthUtilsMockFns.mockSafeAccountInsert,
  getCredential: authOAuthUtilsMockFns.mockGetCredential,
  getOAuthToken: authOAuthUtilsMockFns.mockGetOAuthToken,
  refreshAccessTokenIfNeeded: authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded,
  refreshTokenIfNeeded: authOAuthUtilsMockFns.mockRefreshTokenIfNeeded,
  getCredentialsForCredentialSet: authOAuthUtilsMockFns.mockGetCredentialsForCredentialSet,
}
