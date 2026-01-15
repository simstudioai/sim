/**
 * Mock authentication utilities for API testing
 */
import { vi } from 'vitest'

/**
 * Mock user interface for authentication testing
 */
export interface MockUser {
  id: string
  email: string
  name?: string
}

/**
 * Result object returned by mockAuth with helper methods
 */
export interface MockAuthResult {
  /** The mock getSession function */
  mockGetSession: ReturnType<typeof vi.fn>
  /** Set authenticated state with optional custom user */
  setAuthenticated: (user?: MockUser) => void
  /** Set unauthenticated state (session returns null) */
  setUnauthenticated: () => void
  /** Alias for setAuthenticated */
  mockAuthenticatedUser: (user?: MockUser) => void
  /** Alias for setUnauthenticated */
  mockUnauthenticated: () => void
}

/**
 * Default mock user for testing
 */
export const defaultMockUser: MockUser = {
  id: 'user-123',
  email: 'test@example.com',
}

/**
 * Mock authentication for API tests.
 * Uses vi.doMock to mock the auth module's getSession function.
 *
 * @param user - Optional user object to use for authenticated requests
 * @returns Object with authentication helper functions
 *
 * @example
 * ```ts
 * const auth = mockAuth()
 * auth.setAuthenticated() // User is now authenticated
 * auth.setUnauthenticated() // User is now unauthenticated
 *
 * // With custom user
 * auth.setAuthenticated({ id: 'custom-id', email: 'custom@test.com' })
 * ```
 */
export function mockAuth(user: MockUser = defaultMockUser): MockAuthResult {
  const mockGetSession = vi.fn()

  vi.doMock('@/lib/auth', () => ({
    getSession: mockGetSession,
  }))

  const setAuthenticated = (customUser?: MockUser) =>
    mockGetSession.mockResolvedValue({ user: customUser || user })
  const setUnauthenticated = () => mockGetSession.mockResolvedValue(null)

  return {
    mockGetSession,
    mockAuthenticatedUser: setAuthenticated,
    mockUnauthenticated: setUnauthenticated,
    setAuthenticated,
    setUnauthenticated,
  }
}
