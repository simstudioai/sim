/**
 * API Test Setup
 */
import { afterEach, beforeEach, vi } from 'vitest'

// Mock Next.js implementations
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: vi.fn().mockReturnValue({ value: 'test-session-token' }),
  }),
  headers: () => ({
    get: vi.fn().mockReturnValue('test-value'),
  }),
}))

// Mock auth utilities
vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({
    user: {
      id: 'user-id',
      email: 'test@example.com',
    },
    sessionToken: 'test-session-token',
  }),
}))

// Configure Vitest environment
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks()
})

afterEach(() => {
  // Ensure all mocks are restored after each test
  vi.restoreAllMocks()
})
