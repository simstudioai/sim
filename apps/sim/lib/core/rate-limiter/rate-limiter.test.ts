import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { RateLimiter } from './rate-limiter'
import type { ConsumeResult, RateLimitStorageAdapter, TokenStatus } from './storage'
import { MANUAL_EXECUTION_LIMIT, RATE_LIMITS, RateLimitError } from './types'

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/feature-flags', () => ({ isBillingEnabled: true }))

interface MockAdapter {
  consumeTokens: Mock
  getTokenStatus: Mock
  resetBucket: Mock
}

const createMockAdapter = (): MockAdapter => ({
  consumeTokens: vi.fn(),
  getTokenStatus: vi.fn(),
  resetBucket: vi.fn(),
})

describe('RateLimiter', () => {
  const testUserId = 'test-user-123'
  const freeSubscription = { plan: 'free', referenceId: testUserId }
  let mockAdapter: MockAdapter
  let rateLimiter: RateLimiter

  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter = createMockAdapter()
    rateLimiter = new RateLimiter(mockAdapter as RateLimitStorageAdapter)
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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

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

    it('should deny on storage error (fail closed)', async () => {
      mockAdapter.consumeTokens.mockRejectedValue(new Error('Storage error'))

      const result = await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should work for all non-manual trigger types', async () => {
      const triggerTypes = ['api', 'webhook', 'schedule', 'chat'] as const
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      for (const triggerType of triggerTypes) {
        await rateLimiter.checkRateLimitWithSubscription(
          testUserId,
          freeSubscription,
          triggerType,
          false
        )
        expect(mockAdapter.consumeTokens).toHaveBeenCalled()
        mockAdapter.consumeTokens.mockClear()
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

      expect(status.requestsPerMinute).toBe(MANUAL_EXECUTION_LIMIT)
      expect(status.maxBurst).toBe(MANUAL_EXECUTION_LIMIT)
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
      mockAdapter.getTokenStatus.mockResolvedValue(mockStatus)

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
      mockAdapter.resetBucket.mockResolvedValue(undefined)

      await rateLimiter.resetRateLimit(testUserId)

      expect(mockAdapter.resetBucket).toHaveBeenCalledTimes(3)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:sync`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:async`)
      expect(mockAdapter.resetBucket).toHaveBeenCalledWith(`${testUserId}:api-endpoint`)
    })

    it('should throw error if reset fails', async () => {
      mockAdapter.resetBucket.mockRejectedValue(new Error('Reset failed'))

      await expect(rateLimiter.resetRateLimit(testUserId)).rejects.toThrow('Reset failed')
    })
  })

  describe('subscription plan handling', () => {
    it('should use pro plan limits', async () => {
      const proSubscription = { plan: 'pro', referenceId: testUserId }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.pro.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, proSubscription, 'api', false)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        1,
        RATE_LIMITS.pro.sync
      )
    })

    it('should use enterprise plan limits', async () => {
      const enterpriseSubscription = { plan: 'enterprise', referenceId: 'org-enterprise' }
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.enterprise.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        enterpriseSubscription,
        'api',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `org-enterprise:sync`,
        1,
        RATE_LIMITS.enterprise.sync
      )
    })

    it('should fall back to free plan when subscription is null', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: RATE_LIMITS.free.sync.maxTokens - 1,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(testUserId, null, 'api', false)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        1,
        RATE_LIMITS.free.sync
      )
    })
  })

  describe('schedule trigger type', () => {
    it('should use sync bucket for schedule trigger', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'schedule',
        false
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:sync`,
        1,
        RATE_LIMITS.free.sync
      )
    })

    it('should use async bucket for schedule trigger with isAsync true', async () => {
      const mockResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 10,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(mockResult)

      await rateLimiter.checkRateLimitWithSubscription(
        testUserId,
        freeSubscription,
        'schedule',
        true
      )

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        `${testUserId}:async`,
        1,
        RATE_LIMITS.free.async
      )
    })
  })

  describe('getRateLimitStatusWithSubscription error handling', () => {
    it('should return default config on storage error', async () => {
      mockAdapter.getTokenStatus.mockRejectedValue(new Error('Storage error'))

      const status = await rateLimiter.getRateLimitStatusWithSubscription(
        testUserId,
        freeSubscription,
        'api',
        false
      )

      expect(status.remaining).toBe(0)
      expect(status.requestsPerMinute).toBe(RATE_LIMITS.free.sync.refillRate)
      expect(status.maxBurst).toBe(RATE_LIMITS.free.sync.maxTokens)
    })
  })
})

describe('RateLimitError', () => {
  it('should create error with default status code 429', () => {
    const error = new RateLimitError('Rate limit exceeded')

    expect(error.message).toBe('Rate limit exceeded')
    expect(error.statusCode).toBe(429)
    expect(error.name).toBe('RateLimitError')
  })

  it('should create error with custom status code', () => {
    const error = new RateLimitError('Custom error', 503)

    expect(error.message).toBe('Custom error')
    expect(error.statusCode).toBe(503)
  })

  it('should be instanceof Error', () => {
    const error = new RateLimitError('Test')

    expect(error instanceof Error).toBe(true)
    expect(error instanceof RateLimitError).toBe(true)
  })

  it('should have proper stack trace', () => {
    const error = new RateLimitError('Test error')

    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('RateLimitError')
  })
})
