import { vi } from 'vitest'

/**
 * Mock of the `ServiceAccountTokenError` class from `@/lib/oauth/credential-service`
 * (same constructor, `name` and fields). Declared as a real class so consumer code
 * using `instanceof ServiceAccountTokenError` keeps working under mock.
 */
export class ServiceAccountTokenErrorMock extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorDescription: string,
    public readonly errorCode?: string
  ) {
    super(errorDescription)
    this.name = 'ServiceAccountTokenError'
  }
}

/**
 * Controllable mock functions for `@/lib/oauth/credential-service`.
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
  mockGetSlackBotCredential: vi.fn(),
  mockGetAtlassianServiceAccountSecret: vi.fn(),
  mockResolveServiceAccountToken: vi.fn(),
  mockResolveCredentialTokenBundle: vi.fn(),
  mockSafeAccountInsert: vi.fn(),
  mockGetCredential: vi.fn(),
  mockGetOAuthToken: vi.fn(),
  mockRefreshAccessTokenIfNeeded: vi.fn(),
  mockRefreshTokenIfNeeded: vi.fn(),
  mockGetCredentialTerminalRefreshError: vi.fn(
    async (): Promise<{ errorCode: string; providerId: string } | null> => null
  ),
}

/**
 * Static mock module for `@/lib/oauth/credential-service`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
 * ```
 */
export const authOAuthUtilsMock = {
  ServiceAccountTokenError: ServiceAccountTokenErrorMock,
  resolveOAuthAccountId: authOAuthUtilsMockFns.mockResolveOAuthAccountId,
  getServiceAccountToken: authOAuthUtilsMockFns.mockGetServiceAccountToken,
  getSlackBotCredential: authOAuthUtilsMockFns.mockGetSlackBotCredential,
  getAtlassianServiceAccountSecret: authOAuthUtilsMockFns.mockGetAtlassianServiceAccountSecret,
  resolveServiceAccountToken: authOAuthUtilsMockFns.mockResolveServiceAccountToken,
  resolveCredentialTokenBundle: authOAuthUtilsMockFns.mockResolveCredentialTokenBundle,
  safeAccountInsert: authOAuthUtilsMockFns.mockSafeAccountInsert,
  getCredential: authOAuthUtilsMockFns.mockGetCredential,
  getOAuthToken: authOAuthUtilsMockFns.mockGetOAuthToken,
  refreshAccessTokenIfNeeded: authOAuthUtilsMockFns.mockRefreshAccessTokenIfNeeded,
  refreshTokenIfNeeded: authOAuthUtilsMockFns.mockRefreshTokenIfNeeded,
  getCredentialTerminalRefreshError: authOAuthUtilsMockFns.mockGetCredentialTerminalRefreshError,
}
