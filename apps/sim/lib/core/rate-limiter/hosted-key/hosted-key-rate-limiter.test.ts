import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type {
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenStatus,
} from '@/lib/core/rate-limiter/storage'
import { HostedKeyRateLimiter } from './hosted-key-rate-limiter'
import type { CustomRateLimit, PerRequestRateLimit } from './types'

vi.mock('@sim/logger', () => loggerMock)

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

describe('HostedKeyRateLimiter', () => {
  const testProvider = 'exa'
  const envKeyPrefix = 'EXA_API_KEY'
  let mockAdapter: MockAdapter
  let rateLimiter: HostedKeyRateLimiter
  let originalEnv: NodeJS.ProcessEnv

  const perRequestRateLimit: PerRequestRateLimit = {
    mode: 'per_request',
    requestsPerMinute: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter = createMockAdapter()
    rateLimiter = new HostedKeyRateLimiter(mockAdapter as RateLimitStorageAdapter)

    originalEnv = { ...process.env }
    process.env.EXA_API_KEY_COUNT = '3'
    process.env.EXA_API_KEY_1 = 'test-key-1'
    process.env.EXA_API_KEY_2 = 'test-key-2'
    process.env.EXA_API_KEY_3 = 'test-key-3'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('acquireKey', () => {
    it('should return error when no keys are configured', async () => {
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedResult)

      process.env.EXA_API_KEY_COUNT = undefined
      process.env.EXA_API_KEY_1 = undefined
      process.env.EXA_API_KEY_2 = undefined
      process.env.EXA_API_KEY_3 = undefined

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('No hosted keys configured')
    })

    it('should rate limit billing actor when they exceed their limit', async () => {
      const rateLimitedResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 30000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(rateLimitedResult)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-123'
      )

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      expect(result.retryAfterMs).toBeDefined()
      expect(result.error).toContain('Rate limit exceeded')
    })

    it('should allow billing actor within their rate limit', async () => {
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedResult)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-123'
      )

      expect(result.success).toBe(true)
      expect(result.billingActorRateLimited).toBeUndefined()
      expect(result.key).toBe('test-key-1')
    })

    it('should distribute requests across keys round-robin style', async () => {
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedResult)

      const r1 = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1'
      )
      const r2 = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-2'
      )
      const r3 = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-3'
      )
      const r4 = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-4'
      )

      expect(r1.keyIndex).toBe(0)
      expect(r2.keyIndex).toBe(1)
      expect(r3.keyIndex).toBe(2)
      expect(r4.keyIndex).toBe(0) // Wraps back
    })

    it('should handle partial key availability', async () => {
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedResult)

      process.env.EXA_API_KEY_2 = undefined

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(true)
      expect(result.key).toBe('test-key-1')
      expect(result.envVarName).toBe('EXA_API_KEY_1')

      const r2 = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-2'
      )
      expect(r2.keyIndex).toBe(2) // Skips missing key 1
      expect(r2.envVarName).toBe('EXA_API_KEY_3')
    })
  })

  describe('acquireKey with custom rate limit', () => {
    const customRateLimit: CustomRateLimit = {
      mode: 'custom',
      requestsPerMinute: 5,
      dimensions: [
        {
          name: 'tokens',
          limitPerMinute: 1000,
          extractUsage: (_params, response) => (response.tokenCount as number) ?? 0,
        },
      ],
    }

    it('should enforce requestsPerMinute for custom mode', async () => {
      const rateLimitedResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 30000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(rateLimitedResult)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        customRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      expect(result.error).toContain('Rate limit exceeded')
    })

    it('should allow request when actor request limit and dimensions have budget', async () => {
      const allowedConsume: ConsumeResult = {
        allowed: true,
        tokensRemaining: 4,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedConsume)

      const budgetAvailable: TokenStatus = {
        tokensAvailable: 500,
        maxTokens: 2000,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 60000),
      }
      mockAdapter.getTokenStatus.mockResolvedValue(budgetAvailable)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        customRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(true)
      expect(result.key).toBe('test-key-1')
      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(1)
      expect(mockAdapter.getTokenStatus).toHaveBeenCalledTimes(1)
    })

    it('should block request when a dimension is depleted', async () => {
      const allowedConsume: ConsumeResult = {
        allowed: true,
        tokensRemaining: 4,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedConsume)

      const depleted: TokenStatus = {
        tokensAvailable: 0,
        maxTokens: 2000,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 45000),
      }
      mockAdapter.getTokenStatus.mockResolvedValue(depleted)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        customRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      expect(result.error).toContain('tokens')
    })

    it('should pre-check all dimensions and block on first depleted one', async () => {
      const multiDimensionConfig: CustomRateLimit = {
        mode: 'custom',
        requestsPerMinute: 10,
        dimensions: [
          {
            name: 'tokens',
            limitPerMinute: 1000,
            extractUsage: (_p, r) => (r.tokenCount as number) ?? 0,
          },
          {
            name: 'search_units',
            limitPerMinute: 50,
            extractUsage: (_p, r) => (r.searchUnits as number) ?? 0,
          },
        ],
      }

      const allowedConsume: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(allowedConsume)

      const tokensBudget: TokenStatus = {
        tokensAvailable: 500,
        maxTokens: 2000,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 60000),
      }
      const searchUnitsDepleted: TokenStatus = {
        tokensAvailable: 0,
        maxTokens: 100,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 30000),
      }
      mockAdapter.getTokenStatus
        .mockResolvedValueOnce(tokensBudget)
        .mockResolvedValueOnce(searchUnitsDepleted)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        multiDimensionConfig,
        'workspace-1'
      )

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      expect(result.error).toContain('search_units')
    })
  })

  describe('reportUsage', () => {
    const customConfig: CustomRateLimit = {
      mode: 'custom',
      requestsPerMinute: 5,
      dimensions: [
        {
          name: 'tokens',
          limitPerMinute: 1000,
          extractUsage: (_params, response) => (response.tokenCount as number) ?? 0,
        },
      ],
    }

    it('should consume actual tokens from dimension bucket after execution', async () => {
      const consumeResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 850,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(consumeResult)

      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        customConfig,
        {},
        { tokenCount: 150 }
      )

      expect(result.dimensions).toHaveLength(1)
      expect(result.dimensions[0].name).toBe('tokens')
      expect(result.dimensions[0].consumed).toBe(150)
      expect(result.dimensions[0].allowed).toBe(true)
      expect(result.dimensions[0].tokensRemaining).toBe(850)

      expect(mockAdapter.consumeTokens).toHaveBeenCalledWith(
        'hosted:exa:actor:workspace-1:tokens',
        150,
        expect.objectContaining({ maxTokens: 2000, refillRate: 1000 })
      )
    })

    it('should handle overdrawn bucket gracefully (optimistic concurrency)', async () => {
      const overdrawnResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(overdrawnResult)

      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        customConfig,
        {},
        { tokenCount: 500 }
      )

      expect(result.dimensions[0].allowed).toBe(false)
      expect(result.dimensions[0].consumed).toBe(500)
    })

    it('should skip consumption when extractUsage returns 0', async () => {
      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        customConfig,
        {},
        { tokenCount: 0 }
      )

      expect(result.dimensions).toHaveLength(1)
      expect(result.dimensions[0].consumed).toBe(0)
      expect(mockAdapter.consumeTokens).not.toHaveBeenCalled()
    })

    it('should handle multiple dimensions independently', async () => {
      const multiConfig: CustomRateLimit = {
        mode: 'custom',
        requestsPerMinute: 10,
        dimensions: [
          {
            name: 'tokens',
            limitPerMinute: 1000,
            extractUsage: (_p, r) => (r.tokenCount as number) ?? 0,
          },
          {
            name: 'search_units',
            limitPerMinute: 50,
            extractUsage: (_p, r) => (r.searchUnits as number) ?? 0,
          },
        ],
      }

      const tokensConsumed: ConsumeResult = {
        allowed: true,
        tokensRemaining: 800,
        resetAt: new Date(Date.now() + 60000),
      }
      const searchConsumed: ConsumeResult = {
        allowed: true,
        tokensRemaining: 47,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens
        .mockResolvedValueOnce(tokensConsumed)
        .mockResolvedValueOnce(searchConsumed)

      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        multiConfig,
        {},
        { tokenCount: 200, searchUnits: 3 }
      )

      expect(result.dimensions).toHaveLength(2)
      expect(result.dimensions[0]).toEqual({
        name: 'tokens',
        consumed: 200,
        allowed: true,
        tokensRemaining: 800,
      })
      expect(result.dimensions[1]).toEqual({
        name: 'search_units',
        consumed: 3,
        allowed: true,
        tokensRemaining: 47,
      })

      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(2)
    })

    it('should continue with remaining dimensions if extractUsage throws', async () => {
      const throwingConfig: CustomRateLimit = {
        mode: 'custom',
        requestsPerMinute: 10,
        dimensions: [
          {
            name: 'broken',
            limitPerMinute: 100,
            extractUsage: () => {
              throw new Error('extraction failed')
            },
          },
          {
            name: 'tokens',
            limitPerMinute: 1000,
            extractUsage: (_p, r) => (r.tokenCount as number) ?? 0,
          },
        ],
      }

      const consumeResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 900,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(consumeResult)

      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        throwingConfig,
        {},
        { tokenCount: 100 }
      )

      expect(result.dimensions).toHaveLength(1)
      expect(result.dimensions[0].name).toBe('tokens')
      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(1)
    })

    it('should handle storage errors gracefully', async () => {
      mockAdapter.consumeTokens.mockRejectedValue(new Error('db connection lost'))

      const result = await rateLimiter.reportUsage(
        testProvider,
        'workspace-1',
        customConfig,
        {},
        { tokenCount: 100 }
      )

      expect(result.dimensions).toHaveLength(0)
    })
  })
})
