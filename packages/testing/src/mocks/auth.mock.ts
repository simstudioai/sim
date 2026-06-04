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
 */
export const authMockFns = {
  mockGetSession: vi.fn(),
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
    api: {
      getSession: authMockFns.mockGetSession,
    },
  },
}
