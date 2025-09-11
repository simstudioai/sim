/**
 * API Test Setup
 */
import { afterEach, beforeEach, vi } from 'vitest'

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: vi.fn().mockReturnValue({ value: 'test-session-token' }),
  }),
  headers: () => ({
    get: vi.fn().mockReturnValue('test-value'),
  }),
}))

vi.mock('@/lib/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({
    user: {
      id: 'user-id',
      email: 'test@example.com',
    },
    sessionToken: 'test-session-token',
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})
