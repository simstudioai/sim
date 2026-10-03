import { vi } from 'vitest'

/**
 * Mock user interface for authentication testing.
 */
export interface MockUser {
  id: string
  email: string
  name?: string
}

/**
 * Controllable mock functions for `@/lib/auth`. Override per-test with
 * `authMockFns.mockGetSession.mockResolvedValueOnce(...)`.
 *
 * `getSession` and `auth.api.getSession` share `mockGetSession`. The other
 * `auth.api.*` entries are the Better Auth endpoints tests drive directly;
 * `auth.$context` resolves `{ internalAdapter }` whose `createSession`,
 * `updateSession`, `deleteSession` and `createVerificationValue` are
 * `mockCreateSession` … `mockCreateVerificationValue`. All are bare `vi.fn()`s
 * resolving `undefined` until a test sets them.
 */
export const authMockFns = {
  mockGetSession: vi.fn(),
  mockHandler: vi.fn(),
  mockSignOut: vi.fn(),
  mockSignInSSO: vi.fn(),
  mockRegisterSSOProvider: vi.fn(),
  mockUpdateSSOProvider: vi.fn(),
  mockCreateUser: vi.fn(),
  mockRequestPasswordReset: vi.fn(),
  mockResetPassword: vi.fn(),
  mockCreateSession: vi.fn(),
  mockUpdateSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockCreateVerificationValue: vi.fn(),
}

/**
 * Static mock module for `@/lib/auth`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/auth', () => authMock)
 * ```
 */
export const authMock = {
  getSession: authMockFns.mockGetSession,
  auth: {
    handler: authMockFns.mockHandler,
    api: {
      getSession: authMockFns.mockGetSession,
      signOut: authMockFns.mockSignOut,
      signInSSO: authMockFns.mockSignInSSO,
      registerSSOProvider: authMockFns.mockRegisterSSOProvider,
      updateSSOProvider: authMockFns.mockUpdateSSOProvider,
      createUser: authMockFns.mockCreateUser,
      requestPasswordReset: authMockFns.mockRequestPasswordReset,
      resetPassword: authMockFns.mockResetPassword,
    },
    $context: Promise.resolve({
      internalAdapter: {
        createSession: authMockFns.mockCreateSession,
        updateSession: authMockFns.mockUpdateSession,
        deleteSession: authMockFns.mockDeleteSession,
        createVerificationValue: authMockFns.mockCreateVerificationValue,
      },
    }),
  },
}
