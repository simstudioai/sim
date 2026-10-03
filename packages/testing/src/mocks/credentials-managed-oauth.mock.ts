import { vi } from 'vitest'

/**
 * Stand-in for `ManagedOAuthCredentialError` from `@/lib/credentials/managed-oauth`: same `name`
 * and the real constructor order `(code, message, statusCode)`.
 */
export class MockManagedOAuthCredentialError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: 401 | 403 | 404 | 500 | 502 | 503
  ) {
    super(message)
    this.name = 'ManagedOAuthCredentialError'
  }
}

/**
 * Controllable mock functions for `@/lib/credentials/managed-oauth`. Every function is a bare
 * `vi.fn()`.
 *
 * @example
 * ```ts
 * import { credentialsManagedOauthMockFns } from '@sim/testing/mocks/credentials-managed-oauth.mock'
 *
 * credentialsManagedOauthMockFns.mockResolveManagedOAuthToken.mockResolvedValue({ accessToken: 'token' })
 * ```
 */
export const credentialsManagedOauthMockFns = {
  mockEncryptManagedOAuthTokenSet: vi.fn(),
  mockDecryptManagedOAuthTokenSet: vi.fn(),
  mockLoadManagedOAuthCredentialApplicationContext: vi.fn(),
  mockRejectManagedOAuthToken: vi.fn(),
  mockResolveManagedOAuthToken: vi.fn(),
}

/**
 * Static mock module for `@/lib/credentials/managed-oauth`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)
 * ```
 */
export const credentialsManagedOauthMock = {
  ManagedOAuthCredentialError: MockManagedOAuthCredentialError,
  encryptManagedOAuthTokenSet: credentialsManagedOauthMockFns.mockEncryptManagedOAuthTokenSet,
  decryptManagedOAuthTokenSet: credentialsManagedOauthMockFns.mockDecryptManagedOAuthTokenSet,
  loadManagedOAuthCredentialApplicationContext:
    credentialsManagedOauthMockFns.mockLoadManagedOAuthCredentialApplicationContext,
  rejectManagedOAuthToken: credentialsManagedOauthMockFns.mockRejectManagedOAuthToken,
  resolveManagedOAuthToken: credentialsManagedOauthMockFns.mockResolveManagedOAuthToken,
}
