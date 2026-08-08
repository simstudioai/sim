/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckRateLimitDirect } = vi.hoisted(() => ({
  mockCheckRateLimitDirect: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

vi.mock('@/lib/core/utils/request', () => ({
  getClientIp: () => '203.0.113.7',
}))

import { enforcePerIpRateLimit, enforcePerShareRateLimit } from '@/lib/public-shares/rate-limit'

const request = { headers: { get: () => null } }

/** The config the limiter was handed on the Nth call. */
function configOf(call: number) {
  return mockCheckRateLimitDirect.mock.calls[call][1]
}

function keyOf(call: number): string {
  return mockCheckRateLimitDirect.mock.calls[call][0]
}

describe('public share rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimitDirect.mockResolvedValue({ allowed: true })
  })

  describe('the aggregate ceiling exceeds the per-IP budget it backstops', () => {
    /**
     * The invariant this module exists to hold. An aggregate at or below the
     * per-IP budget is strictly worse than no aggregate: one visitor at full
     * rate saturates the link, so the ceiling binds before the bucket it is
     * meant to backstop and the second viewer of a merely popular share gets a
     * 429. `content` shipped at exactly its per-IP budget (60 and 60) until this
     * was caught, which is why it is asserted rather than assumed.
     */
    it.each(['content', 'inline'] as const)(
      'gives %s a strictly larger aggregate than one visitor can spend',
      async (scope) => {
        await enforcePerIpRateLimit(request, scope)
        await enforcePerShareRateLimit(scope, 'share-1')

        const perIp = configOf(0)
        const aggregate = configOf(1)

        expect(aggregate.refillIntervalMs).toBe(perIp.refillIntervalMs)
        expect(aggregate.maxTokens).toBeGreaterThan(perIp.maxTokens)
        expect(aggregate.refillRate).toBeGreaterThan(perIp.refillRate)
      }
    )

    /**
     * One page view of an image-heavy document issues one request per embedded
     * image. Charging those against the whole-file download budget made the
     * second view of a thirty-image document 429; the budget has to hold several
     * such views.
     */
    it('gives inline room for several fan-out page views, not several files', async () => {
      await enforcePerIpRateLimit(request, 'content')
      await enforcePerIpRateLimit(request, 'inline')

      expect(configOf(1).maxTokens).toBeGreaterThan(configOf(0).maxTokens * 2)
    })

    it('leaves room for several concurrent visitors, not merely one more', async () => {
      await enforcePerIpRateLimit(request, 'content')
      await enforcePerShareRateLimit('content', 'share-1')

      const visitors = configOf(1).maxTokens / configOf(0).maxTokens
      expect(visitors).toBeGreaterThanOrEqual(2)
    })
  })

  describe('bucket separation', () => {
    it('charges the per-IP and per-share buckets under different keys', async () => {
      await enforcePerIpRateLimit(request, 'content')
      await enforcePerShareRateLimit('content', 'share-1')

      expect(keyOf(0)).not.toBe(keyOf(1))
      expect(keyOf(0)).toContain('203.0.113.7')
      expect(keyOf(1)).toContain('share-1')
    })

    it('scopes the aggregate per share, so one hot link cannot throttle another', async () => {
      await enforcePerShareRateLimit('content', 'share-1')
      await enforcePerShareRateLimit('content', 'share-2')

      expect(keyOf(0)).not.toBe(keyOf(1))
    })

    it('scopes the per-IP bucket per scope', async () => {
      await enforcePerIpRateLimit(request, 'metadata')
      await enforcePerIpRateLimit(request, 'content')

      expect(keyOf(0)).not.toBe(keyOf(1))
    })

    /** Each read is a consume, so one request must never debit a bucket twice. */
    it('charges exactly one bucket per call', async () => {
      await enforcePerIpRateLimit(request, 'content')
      expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(1)

      await enforcePerShareRateLimit('content', 'share-1')
      expect(mockCheckRateLimitDirect).toHaveBeenCalledTimes(2)
    })
  })

  describe('responses', () => {
    it('returns null when allowed, so the caller proceeds', async () => {
      await expect(enforcePerIpRateLimit(request, 'content')).resolves.toBeNull()
    })

    it('returns 429 with Retry-After in seconds when exceeded', async () => {
      mockCheckRateLimitDirect.mockResolvedValue({ allowed: false, retryAfterMs: 2400 })

      const response = await enforcePerShareRateLimit('content', 'share-1')

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBe('3')
    })

    it('omits Retry-After when the limiter reports no wait', async () => {
      mockCheckRateLimitDirect.mockResolvedValue({ allowed: false })

      const response = await enforcePerIpRateLimit(request, 'content')

      expect(response?.status).toBe(429)
      expect(response?.headers.get('Retry-After')).toBeNull()
    })
  })

  describe('metadata', () => {
    /**
     * A single indexed lookup spends nothing, so an aggregate could only ever
     * throttle a popular link for no benefit. `enforcePerShareRateLimit` does
     * not accept it — this records that the per-IP budget is deliberately the
     * more generous of the two scopes.
     */
    it('gets a more generous per-IP budget than content', async () => {
      await enforcePerIpRateLimit(request, 'metadata')
      await enforcePerIpRateLimit(request, 'content')

      expect(configOf(0).maxTokens).toBeGreaterThan(configOf(1).maxTokens)
    })
  })
})
