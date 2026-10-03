/**
 * Tests for forget password API route
 */

import { createMockRequest, requestUtilsMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

/**
 * Mocked at the storage boundary rather than at `route-helpers`, so the real
 * key derivation (normalize + hash) is exercised through the route.
 */
vi.mock('@/lib/core/rate-limiter/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

const allowAll = () => ({ allowed: true, resetAt: new Date(Date.now() + 60_000) })

function exhaust(dimension: string, resetAt: Date) {
  mockCheckRateLimitDirect.mockImplementation(async (key: string) =>
    key.includes(dimension) ? { allowed: false, resetAt } : allowAll()
  )
}

function recipientKeys(): string[] {
  return mockCheckRateLimitDirect.mock.calls
    .map(([key]) => key as string)
    .filter((key) => key.includes(':recipient:'))
}

import { APIError } from 'better-auth/api'
import { POST } from '@/app/api/auth/forget-password/route'

const mockRequestPasswordReset = authMockFns.mockRequestPasswordReset
const mockLogger = getMockLogger('ForgetPasswordAPI')

describe('Forget Password API Route', () => {
  beforeEach(() => {
    setEnv({ NEXT_PUBLIC_APP_URL: 'https://app.example.com' })
    mockRequestPasswordReset.mockResolvedValue(undefined)
    mockCheckRateLimitDirect.mockImplementation(async () => allowAll())
  })

  afterAll(() => {
    resetEnvMock()
  })

  it('rejects with 429 once the recipient budget is spent, without sending mail', async () => {
    const resetAt = new Date(Date.now() + 900_000)
    exhaust(':recipient:', resetAt)

    const response = await POST(createMockRequest('POST', { email: 'test@example.com' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('buckets addresses that normalize to the same recipient together', async () => {
    await POST(createMockRequest('POST', { email: 'Test@Example.com' }))
    await POST(createMockRequest('POST', { email: 'test@example.com' }))

    const [first, second] = recipientKeys()
    expect(first).toBe(second)
  })

  it('keys the recipient bucket by hash, never the raw address', async () => {
    await POST(createMockRequest('POST', { email: 'test@example.com' }))

    const [key] = recipientKeys()
    expect(key).toMatch(/^route:forget-password:recipient:[0-9a-f]{64}$/)
  })

  it('short-circuits on the per-IP budget before spending the recipient budget', async () => {
    exhaust(':ip:', new Date(Date.now() + 60_000))

    const response = await POST(createMockRequest('POST', { email: 'test@example.com' }))

    expect(response.status).toBe(429)
    expect(recipientKeys()).toHaveLength(0)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('uses the recipient backstop when the client IP cannot be resolved', async () => {
    requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)

    const response = await POST(createMockRequest('POST', { email: 'test@example.com' }))

    expect(response.status).toBe(200)
    expect(recipientKeys()).toHaveLength(1)
    expect(mockRequestPasswordReset).toHaveBeenCalledOnce()
  })

  it('should reject external redirectTo URL', async () => {
    const req = createMockRequest('POST', {
      email: 'test@example.com',
      redirectTo: 'https://evil.com/phishing',
    })

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.message).toBe('Redirect URL must be a valid same-origin URL')

    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  /**
   * The route answers identically whether or not an account exists, so a refusal must not become a
   * status the success path never produces — that alone would tell a caller which addresses are
   * registered. It is logged rather than surfaced.
   */
  it('answers a refusal Better Auth raises the way it answers a success', async () => {
    mockRequestPasswordReset.mockRejectedValue(
      new APIError('BAD_REQUEST', { message: 'invalid email' })
    )

    const response = await POST(createMockRequest('POST', { email: 'someone@example.com' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
