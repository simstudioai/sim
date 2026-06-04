import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type {
  ConsumeResult,
  RateLimitStorageAdapter,
  TokenStatus,
} from '@/lib/core/rate-limiter/storage'
import { HostedKeyRateLimiter } from './hosted-key-rate-limiter'
import { HEARTBEAT_REFRESH_INTERVAL_MS, type HostedKeyQueue } from './queue'
import type { CustomRateLimit, PerRequestRateLimit } from './types'

/** Force the queue wait to give up on the first iteration by reporting a retry time
 *  larger than the 5-minute MAX_QUEUE_WAIT_MS cap. */
const RETRY_PAST_CAP_MS = 6 * 60 * 1000

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

interface MockQueue {
  enqueue: Mock
  checkHead: Mock
  refreshHeartbeat: Mock
  dequeue: Mock
}

/** Stub queue that defaults to "you're at the head, no waiting" — i.e. acts as if the
 *  queue is empty or Redis is unavailable. Tests override per-call to simulate ordering. */
const createMockQueue = (): MockQueue => {
  const queue: MockQueue = {
    enqueue: vi.fn().mockResolvedValue({ position: 0, enabled: true }),
    checkHead: vi.fn().mockResolvedValue('head'),
    refreshHeartbeat: vi.fn().mockResolvedValue(undefined),
    dequeue: vi.fn().mockResolvedValue(undefined),
  }
  return queue
}

describe('HostedKeyRateLimiter', () => {
  const testProvider = 'exa'
  const envKeyPrefix = 'EXA_API_KEY'
  let mockAdapter: MockAdapter
  let mockQueue: MockQueue
  let rateLimiter: HostedKeyRateLimiter
  let originalEnv: NodeJS.ProcessEnv

  const perRequestRateLimit: PerRequestRateLimit = {
    mode: 'per_request',
    requestsPerMinute: 10,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAdapter = createMockAdapter()
    mockQueue = createMockQueue()
    rateLimiter = new HostedKeyRateLimiter(
      mockAdapter as RateLimitStorageAdapter,
      mockQueue as unknown as HostedKeyQueue
    )

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

    it('should rate limit billing actor when wait exceeds the queue cap', async () => {
      // resetAt past the 5-minute cap forces the wait loop to bail immediately.
      const rateLimitedResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + RETRY_PAST_CAP_MS),
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

    it('should wait for capacity then succeed when bucket refills within the cap', async () => {
      // First call: bucket empty, refills in 100ms (well under cap).
      // Second call: bucket has capacity, consumed.
      const blocked: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 100),
      }
      const allowed: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60000),
      }
      mockAdapter.consumeTokens.mockResolvedValueOnce(blocked).mockResolvedValueOnce(allowed)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-wait'
      )

      expect(result.success).toBe(true)
      expect(result.key).toBe('test-key-1')
      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(2)
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

  describe('FIFO queue ordering', () => {
    const allowed: ConsumeResult = {
      allowed: true,
      tokensRemaining: 9,
      resetAt: new Date(Date.now() + 60000),
    }

    it('enqueues every call onto the per-workspace+provider queue', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)

      await rateLimiter.acquireKey(testProvider, envKeyPrefix, perRequestRateLimit, 'workspace-1')

      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        testProvider,
        'workspace-1',
        expect.any(String)
      )
    })

    it('always dequeues at the end of a successful acquisition', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)

      await rateLimiter.acquireKey(testProvider, envKeyPrefix, perRequestRateLimit, 'workspace-1')

      expect(mockQueue.dequeue).toHaveBeenCalledWith(
        testProvider,
        'workspace-1',
        expect.any(String)
      )
    })

    it('always dequeues even when the call fails (no keys configured)', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)
      process.env.EXA_API_KEY_COUNT = '0'

      await rateLimiter.acquireKey(testProvider, envKeyPrefix, perRequestRateLimit, 'workspace-1')

      expect(mockQueue.dequeue).toHaveBeenCalled()
    })

    it('waits at the head of the queue before consuming from the bucket', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)
      // First two checkHead calls say we're waiting; third says we're up.
      mockQueue.checkHead
        .mockResolvedValueOnce('waiting')
        .mockResolvedValueOnce('waiting')
        .mockResolvedValueOnce('head')

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(true)
      expect(mockQueue.checkHead).toHaveBeenCalledTimes(3)
      // Bucket is only consumed once we reach the head.
      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(1)
    })

    it('refreshes the heartbeat while waiting at the head of the queue', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)

      // We need the wait loop to iterate long enough for HEARTBEAT_REFRESH_INTERVAL_MS
      // to elapse. Use fake timers so we don't actually sleep.
      vi.useFakeTimers()
      try {
        // Queue says we're waiting forever — except after some time we're at head.
        mockQueue.checkHead.mockImplementation(async () => {
          // Advance past the heartbeat interval each time we poll, then say we're up.
          vi.advanceTimersByTime(15_000)
          return mockQueue.checkHead.mock.calls.length >= 2 ? 'head' : 'waiting'
        })

        const promise = rateLimiter.acquireKey(
          testProvider,
          envKeyPrefix,
          perRequestRateLimit,
          'workspace-1'
        )
        // Drain pending timers so the sleep() resolves.
        await vi.runAllTimersAsync()
        await promise

        expect(mockQueue.refreshHeartbeat).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns 429 when the queue wait exceeds the cap', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)
      mockQueue.checkHead.mockResolvedValue('waiting')

      vi.useFakeTimers()
      try {
        const promise = rateLimiter.acquireKey(
          testProvider,
          envKeyPrefix,
          perRequestRateLimit,
          'workspace-1'
        )
        // Burn past the 5-minute cap.
        await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
        const result = await promise

        expect(result.success).toBe(false)
        expect(result.billingActorRateLimited).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('treats "missing" status as proceed (queue evicted, fall through to bucket race)', async () => {
      mockAdapter.consumeTokens.mockResolvedValue(allowed)
      mockQueue.checkHead.mockResolvedValueOnce('missing')

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1'
      )

      expect(result.success).toBe(true)
    })
  })

  describe('execution-budget-bounded waits', () => {
    it('bails immediately when the execution signal is already aborted', async () => {
      const blocked: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 100),
      }
      mockAdapter.consumeTokens.mockResolvedValue(blocked)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1',
        AbortSignal.abort()
      )

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      // Aborted budget => give up on the first bucket check rather than looping.
      expect(mockAdapter.consumeTokens).toHaveBeenCalledTimes(1)
    })

    it('stops waiting promptly when the signal aborts mid-sleep', async () => {
      // Bucket reports a long refill, so the wait sleeps up to the heartbeat cap (10s).
      // Aborting mid-sleep must wake the wait within a tick, not after the full interval.
      const blocked: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 10_000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(blocked)

      const controller = new AbortController()
      const start = Date.now()
      const promise = rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        perRequestRateLimit,
        'workspace-1',
        controller.signal
      )
      // Let the first bucket check run and the sleep begin, then abort.
      await new Promise((resolve) => setTimeout(resolve, 20))
      controller.abort()
      const result = await promise

      expect(result.success).toBe(false)
      expect(result.billingActorRateLimited).toBe(true)
      // Resolved well before the 10s capped sleep would otherwise have elapsed.
      expect(Date.now() - start).toBeLessThan(2000)
    })

    it('keeps waiting past the no-signal fallback cap while the signal is live', async () => {
      // A live (non-aborted) signal means the run still has budget, so the wait must not
      // 429 at the 5-minute MAX_QUEUE_WAIT_MS fallback. The bucket frees up after ~7 min.
      const blocked: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 10_000),
      }
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 9,
        resetAt: new Date(Date.now() + 60_000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(blocked)

      vi.useFakeTimers()
      try {
        const promise = rateLimiter.acquireKey(
          testProvider,
          envKeyPrefix,
          perRequestRateLimit,
          'workspace-1',
          new AbortController().signal
        )
        // Burn well past the 5-minute fallback cap — without a signal this would have 429'd.
        await vi.advanceTimersByTimeAsync(7 * 60 * 1000)
        mockAdapter.consumeTokens.mockResolvedValue(allowedResult)
        await vi.advanceTimersByTimeAsync(HEARTBEAT_REFRESH_INTERVAL_MS)
        const result = await promise

        expect(result.success).toBe(true)
        expect(result.key).toBe('test-key-1')
      } finally {
        vi.useRealTimers()
      }
    })

    it('refreshes the heartbeat during a long low-RPM bucket wait', async () => {
      // Provider with a long refill (retryAfterMs >> heartbeat TTL). The sleep must be
      // capped so the heartbeat is renewed and the head is not reaped mid-wait.
      const blocked: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 60_000),
      }
      const allowedResult: ConsumeResult = {
        allowed: true,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + 60_000),
      }
      mockAdapter.consumeTokens.mockResolvedValue(blocked)

      vi.useFakeTimers()
      try {
        const promise = rateLimiter.acquireKey(
          testProvider,
          envKeyPrefix,
          perRequestRateLimit,
          'workspace-1',
          new AbortController().signal
        )
        await vi.advanceTimersByTimeAsync(3 * HEARTBEAT_REFRESH_INTERVAL_MS)
        mockAdapter.consumeTokens.mockResolvedValue(allowedResult)
        await vi.advanceTimersByTimeAsync(HEARTBEAT_REFRESH_INTERVAL_MS)
        await promise

        expect(mockQueue.refreshHeartbeat).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
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

    it('should enforce requestsPerMinute for custom mode when wait exceeds the cap', async () => {
      const rateLimitedResult: ConsumeResult = {
        allowed: false,
        tokensRemaining: 0,
        resetAt: new Date(Date.now() + RETRY_PAST_CAP_MS),
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

    it('should block request when a dimension wait exceeds the cap', async () => {
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
        nextRefillAt: new Date(Date.now() + RETRY_PAST_CAP_MS),
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

    it('should wait for dimension capacity then succeed when budget refills', async () => {
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
        nextRefillAt: new Date(Date.now() + 100),
      }
      const refilled: TokenStatus = {
        tokensAvailable: 500,
        maxTokens: 2000,
        lastRefillAt: new Date(),
        nextRefillAt: new Date(Date.now() + 60000),
      }
      mockAdapter.getTokenStatus.mockResolvedValueOnce(depleted).mockResolvedValueOnce(refilled)

      const result = await rateLimiter.acquireKey(
        testProvider,
        envKeyPrefix,
        customRateLimit,
        'workspace-dim-wait'
      )

      expect(result.success).toBe(true)
      expect(mockAdapter.getTokenStatus).toHaveBeenCalledTimes(2)
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
        nextRefillAt: new Date(Date.now() + RETRY_PAST_CAP_MS),
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
