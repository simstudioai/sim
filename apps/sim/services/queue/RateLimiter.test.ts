import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from '@/services/queue/RateLimiter'
import { MANUAL_EXECUTION_LIMIT, RATE_LIMITS } from '@/services/queue/types'

// Mock the database module
vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock drizzle-orm
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
  sql: vi.fn((strings, ...values) => ({ sql: strings.join('?'), values })),
  and: vi.fn((...conditions) => ({ and: conditions })),
}))

// Mock getHighestPrioritySubscription
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn().mockResolvedValue(null),
}))

import { db } from '@sim/db'

describe('RateLimiter', () => {
  const rateLimiter = new RateLimiter()
  const testUserId = 'test-user-123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkRateLimit', () => {
    it('should allow unlimited requests for manual trigger type', async () => {
      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'manual', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(result.resetAt).toBeInstanceOf(Date)
      expect(db.select).not.toHaveBeenCalled()
    })

    it('should allow first API request for sync execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 1,
                asyncApiRequests: 0,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'api', false)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should allow first API request for async execution', async () => {
      // Mock select to return empty array (no existing record)
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // No existing record
          }),
        }),
      } as any)

      // Mock insert to return the expected structure
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                syncApiRequests: 0,
                asyncApiRequests: 1,
                windowStart: new Date(),
              },
            ]),
          }),
        }),
      } as any)

      const result = await rateLimiter.checkRateLimit(testUserId, 'free', 'api', true)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(RATE_LIMITS.free.asyncApiExecutionsPerMinute - 1)
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should work for all trigger types except manual', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const

      for (const triggerType of triggerTypes) {
        // Mock select to return empty array (no existing record)
        vi.mocked(db.select).mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]), // No existing record
            }),
          }),
        } as any)

        // Mock insert to return the expected structure
        vi.mocked(db.insert).mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  syncApiRequests: 1,
                  asyncApiRequests: 0,
                  windowStart: new Date(),
                },
              ]),
            }),
          }),
        } as any)

        const result = await rateLimiter.checkRateLimit(testUserId, 'free', triggerType, false)

        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute - 1)
      }
    })
  })

  describe('getRateLimitStatus', () => {
    it('should return unlimited for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatus(testUserId, 'free', 'manual', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should return sync API limits for API trigger type', async () => {
      const mockSelect = vi.fn().mockReturnThis()
      const mockFrom = vi.fn().mockReturnThis()
      const mockWhere = vi.fn().mockReturnThis()
      const mockLimit = vi.fn().mockResolvedValue([])

      vi.mocked(db.select).mockReturnValue({
        from: mockFrom,
        where: mockWhere,
        limit: mockLimit,
      } as any)

      const status = await rateLimiter.getRateLimitStatus(testUserId, 'free', 'api', false)

      expect(status.used).toBe(0)
      expect(status.limit).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.remaining).toBe(RATE_LIMITS.free.syncApiExecutionsPerMinute)
      expect(status.resetAt).toBeInstanceOf(Date)
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
