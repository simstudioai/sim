import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from './rate-limiter'
import type { ConsumeResult, RateLimitStorageAdapter, TokenStatus } from './storage'
import { MANUAL_EXECUTION_LIMIT, RATE_LIMITS } from './types'

const createMockAdapter = (): RateLimitStorageAdapter => ({
  consumeTokens: vi.fn(),
  getTokenStatus: vi.fn(),
  resetBucket: vi.fn(),
})

describe('RateLimiter', () => {
  const testUserId = 'test-user-123'
  const freeSubscription = { plan: 'free', referenceId: testUserId }
  let mockAdapter: RateLimitStorageAdapter
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter = createMockAdapter()
    rateLimiter = new RateLimiter(mockAdapter)
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
      expect(mockAdapter.consumeTokens).not.toHaveBeenCalled()
    })

    it('should consume tokens for API requests', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.free.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(mockResult.tokensRemaining)
      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        1,
        RATE_LIMITS.free.sync
      )
    })

    it('should use async bucket for async requests', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.free.async.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, freeSubscription, 'api', true)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:async`,
        1,
        RATE_LIMITS.free.async
      )
    })

    it('should use api-endpoint bucket for api-endpoint trigger', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.free.apiEndpoint.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api-endpoint',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:api-endpoint`,
        1,
        RATE_LIMITS.free.apiEndpoint
      )
    })

    it('should deny requests when rate limit exceeded', async () => {
      const mockResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 60000),
        retryAfterMs: 30000,
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.retryAfterMs).toBe(30000)
    })

    it('should use organization key for team subscriptions', async () => {
      const orgId = 'org-123'
      const teamSubscription = { plan: 'team', referenceId: orgId }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.team.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, teamSubscription, 'api', false)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${orgId}:sync`,
        1,
        RATE_LIMITS.team.sync
      )
    })

    it('should use user key when team subscription referenceId matches userId', async () => {
      const directTeamSubscription = { plan: 'team', referenceId: testUserId }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.team.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        directTeamSubscription,
        'api',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        1,
        RATE_LIMITS.team.sync
      )
    })

    it('should allow on error to avoid blocking users', async () => {
      vi.mocked(mockAdapter.consumeTokens).mockRejectedValue(new Error('Storage error'))

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(true)
    })

    it('should work for all non-manual trigger types', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.consumeTokens).mockResolvedValue(mockResult)

      for (const triggerType of triggerTypes) {
        await rateLimiter.checkRateLimitWithSubscription(
          testUserId,
          freeSubscription,
          triggerType,
          false
        )
        expect(mockAdapter.consumeTokens).toHaveBeenCalled()
        vi.mocked(mockAdapter.consumeTokens).mockClear()
      }
    })
  })

  describe('getRateLimitStatusWithSubscription', () => {
    it('should return unlimited status for manual trigger type', async () => {
      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'manual',
        false
      )

      expect(status.used).toBe(0)
      expect(status.limit).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.remaining).toBe(MANUAL_EXECUTION_LIMIT)
      expect(mockAdapter.getTokenStatus).not.toHaveBeenCalled()
    })

    it('should return status from storage for API requests', async () => {
      const mockStatus: TokenStatus = {
        tokensAvailable: 15,
        maxTokens: RATE_LIMITS.free.sync.maxTokens,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 60000),
      }
      vi.mocked(mockAdapter.getTokenStatus).mockResolvedValue(mockStatus)

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.remaining).toBe(15)
      expect(status.requestsPerMinute).toBe(RATE_LIMITS.free.sync.refillRate)
      expect(status.maxBurst).toBe(RATE_LIMITS.free.sync.maxTokens)
      expect(mockAdapter.getTokenStatus).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        RATE_LIMITS.free.sync
      )
    })
  })

  describe('resetRateLimit', () => {
    it('should reset all bucket types for a user', async () => {
      vi.mocked(mockAdapter.resetBucket).mockResolvedValue()

      await rateLimiter.resetRateLimit(testUserId)

      expect(mockAdapter.resetBucket).toHaveBeenCalledTimes(3)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:sync`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:async`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:api-endpoint`)
    })
  })
})
