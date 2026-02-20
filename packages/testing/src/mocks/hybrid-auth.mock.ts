/**
 * Mock for @/lib/auth/hybrid module.
 * Provides controllable mock functions for checkHybridAuth, checkSessionOrInternalAuth, and checkInternalAuth.
 */
import { vi } from 'vitest'
import type { MockUser } from './auth.mock'
import { defaultMockUser } from './auth.mock'

interface HybridAuthResponse {
  success: boolean
  userId?: string
  userName?: string | null
  userEmail?: string | null
  authType?: 'session' | 'api_key' | 'internal_jwt'
  error?: string
}

/**
 * Result object returned by mockHybridAuth with helper methods
 */
export interface MockHybridAuthResult {
  mockCheckHybridAuth: ReturnType<typeof vi.fn>
  mockCheckSessionOrInternalAuth: ReturnType<typeof vi.fn>
  mockCheckInternalAuth: ReturnType<typeof vi.fn>
  setAuthenticated: (user?: MockUser) => void
  setUnauthenticated: () => void
}

/**
 * Mock hybrid authentication for API tests.
 * Uses vi.doMock to mock the @/lib/auth/hybrid module.
 *
 * @param user - Optional default user for authenticated state
 * @returns Object with mock functions and authentication helpers
 *
 * @example
 * ```ts
 * const hybridAuth = mockHybridAuth()
 * hybridAuth.setAuthenticated() // All hybrid auth checks succeed
 * hybridAuth.setUnauthenticated() // All hybrid auth checks fail
 * ```
 */
export function mockHybridAuth(user: MockUser = defaultMockUser): MockHybridAuthResult {
  const mockCheckHybridAuth = vi.fn<() => Promise<HybridAuthResponse>>()
  const mockCheckSessionOrInternalAuth = vi.fn<() => Promise<HybridAuthResponse>>()
  const mockCheckInternalAuth = vi.fn<() => Promise<HybridAuthResponse>>()

  vi.doMock('@/lib/auth/hybrid', () => ({
    checkHybridAuth: mockCheckHybridAuth,
    checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
    checkInternalAuth: mockCheckInternalAuth,
  }))

  const setAuthenticated = (customUser?: MockUser) => {
    const u = customUser || user
    const response: HybridAuthResponse = {
      success: true,
      userId: u.id,
      userName: u.name ?? null,
      userEmail: u.email,
      authType: 'session',
    }
    mockCheckHybridAuth.mockResolvedValue(response)
    mockCheckSessionOrInternalAuth.mockResolvedValue(response)
    mockCheckInternalAuth.mockResolvedValue(response)
  }

  const setUnauthenticated = () => {
    const response: HybridAuthResponse = {
      success: false,
      error: 'Unauthorized',
    }
    mockCheckHybridAuth.mockResolvedValue(response)
    mockCheckSessionOrInternalAuth.mockResolvedValue(response)
    mockCheckInternalAuth.mockResolvedValue(response)
  }

  return {
    mockCheckHybridAuth,
    mockCheckSessionOrInternalAuth,
    mockCheckInternalAuth,
    setAuthenticated,
    setUnauthenticated,
  }
}
