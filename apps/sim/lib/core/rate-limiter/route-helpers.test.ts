/**
 * @vitest-environment node
 */
import { createMockRequest, requestUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockAdapter } = vi.hoisted(() => ({
  mockAdapter: {
    consumeTokens: vi.fn(),
    getTokenStatus: vi.fn(),
    resetBucket: vi.fn(),
  },
}))

vi.mock('@/lib/core/rate-limiter/storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/core/rate-limiter/storage')>(
    '@/lib/core/rate-limiter/storage'
  )
  return {
    ...actual,
    createStorageAdapter: () => mockAdapter,
  }
})

function passThroughClientIp() {
  requestUtilsMockFns.mockGetClientIp.mockImplementation(
    (req: { headers: { get(name: string): string | null } }) =>
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip')?.trim() ||
      'unknown'
  )
}

import { enforceIpRateLimit, enforceUserOrIpRateLimit, enforceUserRateLimit } from './route-helpers'

const consume = mockAdapter.consumeTokens as Mock

describe('route-helpers rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('enforceUserRateLimit', () => {
    it('returns null when the bucket has tokens left', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 59,
        resetAt: new Date(Date.now() + 60_000),
      })

      const result = await enforceUserRateLimit('test-bucket', 'user-1')

      expect(result).toBeNull()
      expect(consume).toHaveBeenCalledWith(
        'route:test-bucket:user:user-1',
        1,
        expect.objectContaining({ maxTokens: 60, refillRate: 30 })
      )
    })

    it('returns a 429 with Retry-After when the bucket is empty', async () => {
      const resetAt = new Date(Date.now() + 30_000)
      consume.mockResolvedValueOnce({
        allowed: false,
        tokensRemaining: 0,
        resetAt,
        retryAfterMs: 30_000,
      })

      const result = await enforceUserRateLimit('test-bucket', 'user-1')

      expect(result).not.toBeNull()
      expect(result?.status).toBe(429)
      expect(result?.headers.get('Retry-After')).toBe('30')
      expect(result?.headers.get('X-RateLimit-Reset')).toBe(resetAt.toISOString())

      const body = await result?.json()
      expect(body?.error).toBe('Rate limit exceeded')
    })

    it('keys buckets per user so different users do not share state', async () => {
      consume.mockResolvedValue({
        allowed: true,
        tokensRemaining: 59,
        resetAt: new Date(),
      })

      await enforceUserRateLimit('shared-bucket', 'user-a')
      await enforceUserRateLimit('shared-bucket', 'user-b')

      const keys = consume.mock.calls.map((call) => call[0])
      expect(keys).toEqual(['route:shared-bucket:user:user-a', 'route:shared-bucket:user:user-b'])
    })

    it('fails open when the storage layer throws', async () => {
      consume.mockRejectedValueOnce(new Error('redis down'))

      const result = await enforceUserRateLimit('test-bucket', 'user-1')

      expect(result).toBeNull()
    })
  })

  describe('enforceIpRateLimit', () => {
    beforeEach(() => {
      passThroughClientIp()
    })

    it('uses the X-Forwarded-For client IP in the bucket key', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(),
      })
      const request = createMockRequest('POST', undefined, {
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      })

      await enforceIpRateLimit('public-bucket', request)

      expect(consume).toHaveBeenCalledWith(
        'route:public-bucket:ip:203.0.113.7',
        1,
        expect.any(Object)
      )
    })

    it('folds spoofed `X-Forwarded-For: unknown` into a single shared bucket', async () => {
      consume.mockResolvedValue({
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(),
      })

      const reqA = createMockRequest('POST', undefined, { 'x-forwarded-for': 'unknown' })
      const reqB = createMockRequest('POST', undefined, { 'x-forwarded-for': 'unknown' })
      await enforceIpRateLimit('otp', reqA)
      await enforceIpRateLimit('otp', reqB)

      const keys = consume.mock.calls.map((call) => call[0])
      expect(keys).toEqual(['route:otp:ip:unknown', 'route:otp:ip:unknown'])
    })

    it('returns a 429 with Retry-After on rate limit', async () => {
      const resetAt = new Date(Date.now() + 60_000)
      consume.mockResolvedValueOnce({
        allowed: false,
        tokensRemaining: 0,
        resetAt,
        retryAfterMs: 60_000,
      })
      const request = createMockRequest('POST', undefined, { 'x-forwarded-for': '203.0.113.7' })

      const result = await enforceIpRateLimit('public-bucket', request)

      expect(result?.status).toBe(429)
      expect(result?.headers.get('Retry-After')).toBe('60')
    })
  })

  describe('enforceUserOrIpRateLimit', () => {
    beforeEach(() => {
      passThroughClientIp()
    })

    it('keys per-user when userId is present', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 59,
        resetAt: new Date(),
      })
      const request = createMockRequest('POST', undefined, { 'x-forwarded-for': '203.0.113.7' })

      await enforceUserOrIpRateLimit('a2a-test', 'user-1', request)

      expect(consume).toHaveBeenCalledWith('route:a2a-test:user:user-1', 1, expect.any(Object))
    })

    it('falls back to per-IP when userId is undefined', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 59,
        resetAt: new Date(),
      })
      const request = createMockRequest('POST', undefined, { 'x-forwarded-for': '203.0.113.7' })

      await enforceUserOrIpRateLimit('a2a-test', undefined, request)

      expect(consume).toHaveBeenCalledWith('route:a2a-test:ip:203.0.113.7', 1, expect.any(Object))
    })
  })
})
