/**
 * @vitest-environment node
 */
import { requestUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

import { enforcePublicFileRateLimit } from '@/lib/public-shares/rate-limit'
import { MAX_EMBEDDED_IMAGES } from '@/lib/uploads/server/embedded-image-refs'

const request = new Request('http://localhost')

describe('enforcePublicFileRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('192.0.2.1')
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
  })

  it.each([
    ['metadata', 120, 120],
    ['content', 60, 60],
    ['inline', MAX_EMBEDDED_IMAGES * 3, 60],
  ] as const)('uses a separate bounded per-IP %s bucket', async (scope, maxTokens, refillRate) => {
    expect(await enforcePublicFileRateLimit(request, scope)).toBeNull()
    expect(mockCheckRateLimitDirect).toHaveBeenCalledExactlyOnceWith(
      `public-file:${scope}:192.0.2.1`,
      { maxTokens, refillRate, refillIntervalMs: 60_000 }
    )
  })

  it('does not charge different clients to the same bucket', async () => {
    await enforcePublicFileRateLimit(request, 'inline')
    requestUtilsMockFns.mockGetClientIp.mockReturnValue('192.0.2.2')
    await enforcePublicFileRateLimit(request, 'inline')

    expect(mockCheckRateLimitDirect.mock.calls.map(([key]) => key)).toEqual([
      'public-file:inline:192.0.2.1',
      'public-file:inline:192.0.2.2',
    ])
  })

  it.each(['metadata', 'content', 'inline'] as const)(
    'fails closed for %s without a shared bucket when the client IP cannot be resolved',
    async (scope) => {
      requestUtilsMockFns.mockGetClientIp.mockReturnValue(null)

      const response = await enforcePublicFileRateLimit(request, scope)

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe('60')
      expect(mockCheckRateLimitDirect).not.toHaveBeenCalled()
    }
  )

  it.each(['metadata', 'content', 'inline'] as const)(
    'returns the limiter retry delay rounded up to seconds for %s',
    async (scope) => {
      mockCheckRateLimitDirect.mockResolvedValue({ allowed: false, retryAfterMs: 1_001 })

      const response = await enforcePublicFileRateLimit(request, scope)

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe('2')
      expect(await response?.json()).toEqual({
        error: 'Too many requests. Please try again later.',
      })
    }
  )

  it('keeps document reads available when the inline-image bucket is exhausted', async () => {
    mockCheckRateLimitDirect.mockImplementation(async (key: string) => ({
      allowed: !key.startsWith('public-file:inline:'),
      retryAfterMs: 60_000,
    }))

    expect((await enforcePublicFileRateLimit(request, 'inline'))?.status).toBe(429)
    expect(await enforcePublicFileRateLimit(request, 'content')).toBeNull()
    expect(await enforcePublicFileRateLimit(request, 'metadata')).toBeNull()
  })
})
