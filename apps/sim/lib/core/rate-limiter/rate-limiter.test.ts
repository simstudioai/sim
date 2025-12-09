import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import { MANUAL_EXECUTION_LIMIT, RATE_LIMITS } from '@/lib/core/rate-limiter/types'

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
  sql: vi.fn((strings, ...values) => ({ sql: strings.join('?'), values })),
  and: vi.fn((...conditions) => ({ and: conditions })),
}))

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: vi.fn().mockReturnValue(null),
}))

import { db } from '@sim/db'
import { getRedisClient } from '@/lib/core/config/redis'

describe('RateLimiter', () => {
  const rateLimiter = new RateLimiter()
  const testUserId = 'test-user-123'
  const freeSubscription = { plan: 'free', referenceId: testUserId }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRedisClient).mockReturnValue(null)
  })

  describe('checkRateLimitWithSubscription', () => {
    it('should allow unlimited requests for manual trigger type', async () => {
      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'manual',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(result.resetAt).toBeInstanceOf(Date)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('should allow first API request for sync execution (DB fallback)', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any)

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 1,
                asyncApiRequests: 0,
                apiEndpointRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should allow first API request for async execution (DB fallback)', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any)

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 0,
                asyncApiRequests: 1,
                apiEndpointRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        true
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.asyncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should work for all trigger types except manual (DB fallback)', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const

      for (const triggerType of triggerTypes) {
        vi.mocked(db.select).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        } as any)

        vi.mocked(db.insert).mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  syncApiRequests: 1,
                  asyncApiRequests: 0,
                  apiEndpointRequests: 0,
                  windowStart: new Date(),
                },
              ]),
            }),
          }),
        } as any)

        const result = await rateLimiter.checkRateLimitWithSubscription(
          testUserId,
          freeSubscription,
          triggerType,
          false
        )

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      }
    })

    it('should use Redis when available', async () => {
      const mockRedis = {
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      }
      vi.mocked(getRedisClient).mockReturnValue(mockRedis as any)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      expect(mockRedis.incr).toHaveBeenCalled()
      expect(mockRedis.expire).toHaveBeenCalled()
      expect(db.select).not.toHaveBeenCalled()
    })

    it('should deny requests when Redis rate limit exceeded', async () => {
      const mockRedis = {
        incr: vi.fn().mockResolvedValue(RATE_LIMITS.free.syncApiExecutionsPerMinute + 1),
        expire: vi.fn().mockResolvedValue(1),
      }
      vi.mocked(getRedisClient).mockReturnValue(mockRedis as any)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should fall back to DB when Redis fails', async () => {
      const mockRedis = {
        incr: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      }
      vi.mocked(getRedisClient).mockReturnValue(mockRedis as any)

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any)

      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 1,
                asyncApiRequests: 0,
                apiEndpointRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(db.select).toHaveBeenCalled()
    })
  })

  describe('getRateLimitStatusWithSubscription', () => {
    it('should return unlimited for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'manual',
        false
      )

      expect(status.used).toBe(0)
      expect(status.limit).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should return sync API limits for API trigger type (DB fallback)', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any)

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.used).toBe(0)
      expect(status.limit).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should use Redis for status when available', async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue('5'),
      }
      vi.mocked(getRedisClient).mockReturnValue(mockRedis as any)

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.used).toBe(5)
      expect(status.limit).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 5)
      expect(mockRedis.get).toHaveBeenCalled()
      expect(db.select).not.toHaveBeenCalled()
    })
  })

  describe('resetRateLimit', () => {
    it('should delete rate limit record for user', async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      } as any)

      await rateLimiter.resetRateLimit(testUserId)

      expect(db.delete).toHaveBeenCalled()
    })
  })
})
