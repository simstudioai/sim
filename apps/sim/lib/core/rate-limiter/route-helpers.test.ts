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

import {
  enforceIpRateLimit,
  enforceIpRateLimitWithIndependentBackstop,
  enforceResourceRateLimit,
  enforceUserOrIpRateLimit,
  enforceUserRateLimit,
} from './route-helpers'

const consume = mockAdapter.consumeTokens as Mock

describe('route-helpers rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('enforceIpRateLimitWithIndependentBackstop', () => {
    it('scopes the per-IP bucket to a resource without polluting the bucket name', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 19,
        resetAt: new Date(Date.now() + 60_000),
      })

      requestUtilsMockFns.mockGetClientIp.mockReturnValue('203.0.113.9')

      const result = await enforceIpRateLimitWithIndependentBackstop(
        'chat-execute',
        createMockRequest('POST'),
        { maxTokens: 40, refillRate: 20, refillIntervalMs: 60_000 },
        'chat-1'
      )

      expect(result).toBeNull()
      expect(consume).toHaveBeenCalledWith(
        'route:chat-execute:resource:chat-1:ip:203.0.113.9',
        1,
        expect.anything()
      )
    })

    it('keeps the unscoped key shape when no resource is named', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60_000),
      })

      requestUtilsMockFns.mockGetClientIp.mockReturnValue('203.0.113.9')

      await enforceIpRateLimitWithIndependentBackstop('forget-password', createMockRequest('POST'))

      expect(consume).toHaveBeenCalledWith(
        'route:forget-password:ip:203.0.113.9',
        1,
        expect.anything()
      )
    })
  })

  describe('enforceResourceRateLimit', () => {
    const config = { maxTokens: 300, refillRate: 300, refillIntervalMs: 60_000 }

    it('keys the bucket on the resource, not on the caller', async () => {
      consume.mockResolvedValueOnce({
        allowed: true,
        tokensRemaining: 299,
        resetAt: new Date(Date.now() + 60_000),
      })

      const result = await enforceResourceRateLimit('chat-execute', 'chat-1', config)

      expect(result).toBeNull()
      expect(consume).toHaveBeenCalledWith('route:chat-execute:resource:chat-1', 1, config)
    })

    it('returns a 429 with Retry-After when the resource budget is spent', async () => {
      consume.mockResolvedValueOnce({
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 30_000),
      })

      const result = await enforceResourceRateLimit('chat-execute', 'chat-1', config)

      expect(result?.status).toBe(429)
      expect(Number(result?.headers.get('Retry-After'))).toBeGreaterThan(0)
    })
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
      requestUtilsMockFns.mockGetClientIp.mockReturnValue('203.0.113.7')
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

    it('fails closed without creating a shared bucket when the client IP cannot be resolved', async () => {
      requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)
      const request = createMockRequest('POST')

      const result = await enforceIpRateLimit('otp', request)

      expect(result?.status).toBe(429)
      expect(result?.headers.get('Retry-After')).toBe('60')
      expect(consume).not.toHaveBeenCalled()
    })

    it('defers an unresolved client only when the caller declares an independent backstop', async () => {
      requestUtilsMockFns.mockGetClientIp.mockReturnValueOnce(null)
      const request = createMockRequest('POST')

      const result = await enforceIpRateLimitWithIndependentBackstop('password-reset', request)

      expect(result).toBeNull()
      expect(consume).not.toHaveBeenCalled()
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
      requestUtilsMockFns.mockGetClientIp.mockReturnValue('203.0.113.7')
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
