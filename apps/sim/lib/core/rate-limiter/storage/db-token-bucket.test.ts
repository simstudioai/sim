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

  it('initializes request and cooldown buckets in a consistent order without duplicate keys', async () => {
    const now = new Date()
    dbChainMockFns.limit.mockResolvedValue([
      { key: 'cooldown', tokens: '0', lastRefillAt: now, blockedUntil: null },
      { key: 'requests', tokens: '10', lastRefillAt: now, blockedUntil: null },
      { key: 'tokens', tokens: '10', lastRefillAt: now, blockedUntil: null },
    ])

    expect(
      await new DbTokenBucket().consumeTokensAtomically(
        [
          { key: 'tokens', cost: 2, config: CONFIG },
          { key: 'requests', cost: 1, config: CONFIG },
        ],
        { cooldownKeys: ['cooldown', 'cooldown'], deadlineAt: now.getTime() + 1000 }
      )
    ).toEqual({ allowed: true, retryAfterMs: 0 })

    expect(dbChainMockFns.values).toHaveBeenCalledExactlyOnceWith([
      { key: 'cooldown', tokens: '0', lastRefillAt: now, updatedAt: now },
      { key: 'requests', tokens: '10', lastRefillAt: now, updatedAt: now },
      { key: 'tokens', tokens: '10', lastRefillAt: now, updatedAt: now },
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      tokens: '8',
      lastRefillAt: now,
      updatedAt: now,
    })
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      tokens: '9',
      lastRefillAt: now,
      updatedAt: now,
    })
  })

  it('accepts an empty reservation without attempting an empty insert', async () => {
    dbChainMockFns.limit.mockResolvedValue([])

    expect(
      await new DbTokenBucket().consumeTokensAtomically([], {
        cooldownKeys: [],
        deadlineAt: Date.now() + 1000,
      })
    ).toEqual({ allowed: true, retryAfterMs: 0 })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
