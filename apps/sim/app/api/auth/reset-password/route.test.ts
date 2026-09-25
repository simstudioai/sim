/**
 * Tests for reset password API route
 */

import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { APIError } from 'better-auth/api'
import { POST } from '@/app/api/auth/reset-password/route'

const mockResetPassword = authMockFns.mockResetPassword
const mockLogger = getMockLogger('PasswordResetAPI')

describe('Reset Password API Route', () => {
  beforeEach(() => {
    mockResetPassword.mockResolvedValue(undefined)
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: true,
      resetAt: new Date(Date.now() + 60_000),
    })
  })

  it('rejects with 429 once the per-IP budget is spent, without consuming the token', async () => {
    mockCheckRateLimitDirect.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 900_000),
    })

    const response = await POST(
      createMockRequest('POST', { token: 'guess', newPassword: 'newSecurePassword123!' })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('refuses an invalid or expired token with a 400, not a server error', async () => {
    // Better Auth reports a consumed, expired, or fabricated token as a 400-class APIError.
    // Re-emitting that as a 500 paged on a routine click of a stale reset link.
    mockResetPassword.mockRejectedValue(new APIError('BAD_REQUEST', { message: 'invalid token' }))

    const response = await POST(
      createMockRequest('POST', { token: 'expired-token', newPassword: 'newSecurePassword123!' })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'This reset link is invalid or has expired. Please request a new one.',
    })
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})
