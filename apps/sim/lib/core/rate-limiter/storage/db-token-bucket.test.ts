/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'

const CONFIG = { maxTokens: 10, refillRate: 1, refillIntervalMs: 1000 }

describe('PostgreSQL token bucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'))
    vi.clearAllMocks()
    resetDbChainMock()
  })

  afterEach(() => vi.useRealTimers())

  it('preserves an insufficient balance so a later refill can admit the request', async () => {
    const stored = { tokens: '2', lastRefillAt: new Date() }
    dbChainMockFns.limit.mockImplementation(async () => [stored])
    dbChainMockFns.set.mockImplementation((values) => {
      Object.assign(stored, values)
      return { where: vi.fn().mockResolvedValue(undefined) }
    })
    const bucket = new DbTokenBucket()
    expect(await bucket.consumeTokens('key', 3, CONFIG)).toMatchObject({
      allowed: false,
      tokensRemaining: 2,
      retryAfterMs: 1000,
    })
    expect(stored.tokens).toBe('2')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await bucket.consumeTokens('key', 3, CONFIG)).toMatchObject({
      allowed: true,
      tokensRemaining: 0,
    })
  })

  it('normalizes legacy denial markers and computes the complete refill wait', async () => {
    dbChainMockFns.limit.mockResolvedValue([{ tokens: '-1', lastRefillAt: new Date() }])
    expect(await new DbTokenBucket().consumeTokens('key', 3, CONFIG)).toMatchObject({
      allowed: false,
      tokensRemaining: 0,
      retryAfterMs: 3000,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith(expect.objectContaining({ tokens: '0' }))
  })
})
