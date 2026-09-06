import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitStorageAdapter } from '@/lib/core/rate-limiter/storage/adapter'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'
import { RedisTokenBucket } from '@/lib/core/rate-limiter/storage/redis-token-bucket'

const redisUrl = process.env.KNOWLEDGE_ACL_TEST_REDIS_URL
if (redisUrl) {
  const target = new URL(redisUrl)
  if (
    target.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error('Provider admission tests require an explicitly configured local Redis')
  }
}

describe.each(['PostgreSQL', 'Redis'] as const)('%s provider admission', (backend) => {
  describe.runIf(backend === 'PostgreSQL' || Boolean(redisUrl))('real shared buckets', () => {
    let redis: Redis | undefined
    let first: RateLimitStorageAdapter
    let second: RateLimitStorageAdapter
    let key: string
    let now: Date

    beforeAll(async () => {
      if (backend === 'Redis') {
        redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0 })
        await redis.connect()
        first = new RedisTokenBucket(redis)
        second = new RedisTokenBucket(redis)
      } else {
        first = new DbTokenBucket()
        second = new DbTokenBucket()
      }
    })

    beforeEach(() => {
      now = new Date()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
      key = `provider-integration:${generateId()}`
    })

    afterEach(async () => {
      vi.useRealTimers()
      await Promise.all(
        [key, `${key}:requests`, `${key}:tokens`, `${key}:cooldown`, `${key}:quota`].map((item) =>
          first.resetBucket(item)
        )
      )
    })

    afterAll(async () => {
      await redis?.quit()
    })

    it('admits only the shared burst under concurrent callers', async () => {
      const config = { maxTokens: 8, refillRate: 1, refillIntervalMs: 1000 }
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          (index % 2 === 0 ? first : second).consumeTokens(key, 1, config)
        )
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(8)
      expect(results.every((result) => result.tokensRemaining >= 0)).toBe(true)
      expect(await first.getTokenStatus(key, config)).toMatchObject({ tokensAvailable: 0 })
    })

    it('preserves fractional refills and returns the full admission wait', async () => {
      const config = { maxTokens: 1, refillRate: 0.25, refillIntervalMs: 1000 }
      expect(await first.consumeTokens(key, 1, config)).toMatchObject({ allowed: true })
      vi.setSystemTime(now.getTime() + 1000)
      expect(await second.consumeTokens(key, 1, config)).toMatchObject({
        allowed: false,
        tokensRemaining: 0.25,
        retryAfterMs: 3000,
      })
      expect(await first.getTokenStatus(key, config)).toMatchObject({ tokensAvailable: 0.25 })
      vi.setSystemTime(now.getTime() + 4000)
      expect(await second.consumeTokens(key, 1, config)).toMatchObject({
        allowed: true,
        tokensRemaining: 0,
      })
    })

    it('retains minute-scale token budgets until a complete refill is possible', async () => {
      const config = { maxTokens: 600_000, refillRate: 10_000, refillIntervalMs: 1000 }
      expect(await first.consumeTokens(key, 600_000, config)).toMatchObject({ allowed: true })
      if (redis) {
        expect(await redis.pttl(`ratelimit:tb:${key}`)).toBeGreaterThan(60_000)
      }
      vi.setSystemTime(now.getTime() + 3000)
      expect(await second.consumeTokens(key, 600_000, config)).toMatchObject({
        allowed: false,
        tokensRemaining: 30_000,
        retryAfterMs: 57_000,
      })
      vi.setSystemTime(now.getTime() + 60_000)
      expect(await first.consumeTokens(key, 600_000, config)).toMatchObject({
        allowed: true,
        tokensRemaining: 0,
      })
    })

    it('reserves both dimensions atomically under concurrent workers', async () => {
      const requests = {
        key: `${key}:requests`,
        cost: 1,
        config: { maxTokens: 8, refillRate: 1, refillIntervalMs: 1000 },
      }
      const tokens = {
        key: `${key}:tokens`,
        cost: 10,
        config: { maxTokens: 100, refillRate: 10, refillIntervalMs: 1000 },
      }
      const options = {
        cooldownKeys: [`${key}:cooldown`, `${key}:quota`],
        deadlineAt: now.getTime() + 10_000,
      }
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          (index % 2 ? first : second).consumeTokensAtomically([requests, tokens], options)
        )
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(8)
      expect(await first.getTokenStatus(tokens.key, tokens.config)).toMatchObject({
        tokensAvailable: 20,
      })
      expect(await second.getTokenStatus(requests.key, requests.config)).toMatchObject({
        tokensAvailable: 0,
      })
      vi.setSystemTime(now.getTime() + 1000)
      expect(await second.consumeTokensAtomically([requests, tokens], options)).toMatchObject({
        allowed: true,
      })
      expect(await first.getTokenStatus(tokens.key, tokens.config)).toMatchObject({
        tokensAvailable: 20,
      })
    })

    it('shares rate-limit and quota pauses, preserving the latest reset under concurrent writers', async () => {
      const reservation = {
        key: `${key}:tokens`,
        cost: 10,
        config: { maxTokens: 100, refillRate: 10, refillIntervalMs: 1000 },
      }
      const options = {
        cooldownKeys: [`${key}:cooldown`, `${key}:quota`],
        deadlineAt: now.getTime() + 600_000,
      }
      await Promise.all([
        first.setCooldownUntil(`${key}:cooldown`, new Date(now.getTime() + 2000)),
        second.setCooldownUntil(`${key}:cooldown`, new Date(now.getTime() + 5000)),
        first.setCooldownUntil(`${key}:quota`, new Date(now.getTime() + 300_000)),
      ])
      expect(await second.getCooldownUntil(`${key}:cooldown`)).toEqual(
        new Date(now.getTime() + 5000)
      )
      expect(await second.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: false,
        retryAfterMs: 300_000,
      })
      expect(await first.getTokenStatus(reservation.key, reservation.config)).toMatchObject({
        tokensAvailable: 100,
      })
      vi.setSystemTime(now.getTime() + 300_000)
      expect(await first.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      })
    })

    it('spends no dimension for cancelled or expired admission', async () => {
      const reservation = {
        key: `${key}:tokens`,
        cost: 10,
        config: { maxTokens: 100, refillRate: 10, refillIntervalMs: 1000 },
      }
      const options = { cooldownKeys: [`${key}:cooldown`], deadlineAt: now.getTime() }
      expect(await first.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: false,
        retryAfterMs: 0,
      })
      await expect(
        second.consumeTokensAtomically([reservation], {
          ...options,
          deadlineAt: now.getTime() + 1000,
          signal: AbortSignal.abort(new Error('cancelled')),
        })
      ).rejects.toThrow('cancelled')
      expect(await first.getTokenStatus(reservation.key, reservation.config)).toMatchObject({
        tokensAvailable: 100,
      })
    })

    it('applies a reduced capacity immediately to an existing bucket', async () => {
      const config = { maxTokens: 8, refillRate: 1, refillIntervalMs: 1000 }
      await first.consumeTokens(key, 1, config)
      expect(await second.consumeTokens(key, 2, { ...config, maxTokens: 2 })).toMatchObject({
        allowed: true,
        tokensRemaining: 0,
      })
      expect(await first.consumeTokens(key, 1, { ...config, maxTokens: 2 })).toMatchObject({
        allowed: false,
      })
    })
  })
})
