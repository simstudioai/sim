import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AtomicAdmissionResult,
  RateLimitStorageAdapter,
} from '@/lib/core/rate-limiter/storage/adapter'
import { DbTokenBucket } from '@/lib/core/rate-limiter/storage/db-token-bucket'
import { RedisTokenBucket } from '@/lib/core/rate-limiter/storage/redis-token-bucket'

const redisUrl = readTestRedisUrl()

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

    it('refills fractional reservations by whole intervals and returns the full wait', async () => {
      const reservation = {
        key: `${key}:requests`,
        cost: 1,
        config: { maxTokens: 1, refillRate: 0.25, refillIntervalMs: 1000 },
      }
      const options = { cooldownKeys: [`${key}:cooldown`], deadlineAt: now.getTime() + 600_000 }
      expect(await first.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      })
      vi.setSystemTime(now.getTime() + 1500)
      expect(await second.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: false,
        retryAfterMs: 2500,
      })
      expect(await first.getTokenStatus(reservation.key, reservation.config)).toMatchObject({
        tokensAvailable: 0.25,
        lastRefillAt: new Date(now.getTime() + 1000),
      })
      vi.setSystemTime(now.getTime() + 4000)
      expect(await second.consumeTokensAtomically([reservation], options)).toEqual({
        allowed: true,
        retryAfterMs: 0,
      })
      expect(await first.getTokenStatus(reservation.key, reservation.config)).toMatchObject({
        tokensAvailable: 0,
        lastRefillAt: new Date(now.getTime() + 4000),
      })
    })

    it.each([
      { state: 'new', spentRequests: 0, spentTokens: 0, admitted: 8, remainingTokens: 20 },
      { state: 'existing', spentRequests: 2, spentTokens: 20, admitted: 6, remainingTokens: 20 },
      { state: 'partial', spentRequests: 0, spentTokens: 20, admitted: 8, remainingTokens: 0 },
    ])('reserves $state buckets atomically despite reversed caller order', async (fixture) => {
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
      if (fixture.spentRequests > 0) {
        await first.consumeTokens(requests.key, fixture.spentRequests, requests.config)
        await first.setCooldownUntil(`${key}:quota`, now)
      }
      if (fixture.spentTokens > 0) {
        await first.consumeTokens(tokens.key, fixture.spentTokens, tokens.config)
        await first.setCooldownUntil(`${key}:cooldown`, now)
      }
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          (index % 2 ? first : second).consumeTokensAtomically(
            index % 2 ? [requests, tokens] : [tokens, requests],
            {
              ...options,
              cooldownKeys: index % 2 ? options.cooldownKeys : [...options.cooldownKeys].reverse(),
            }
          )
        )
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(fixture.admitted)
      expect(await first.getTokenStatus(tokens.key, tokens.config)).toMatchObject({
        tokensAvailable: fixture.remainingTokens,
      })
      expect(await second.getTokenStatus(requests.key, requests.config)).toMatchObject({
        tokensAvailable: 0,
      })
      vi.setSystemTime(now.getTime() + 1000)
      expect(await second.consumeTokensAtomically([requests, tokens], options)).toMatchObject({
        allowed: true,
      })
      expect(await first.getTokenStatus(tokens.key, tokens.config)).toMatchObject({
        tokensAvailable: fixture.remainingTokens,
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

describe('PostgreSQL admission under a held bucket lock', () => {
  const bucket = new DbTokenBucket()
  let key: string
  let now: number

  /** How long the competing transaction holds the row; long enough to cross a refill interval. */
  const LOCK_HOLD_MS = 1200

  beforeEach(() => {
    now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    key = `provider-integration:${generateId()}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    await bucket.resetBucket(key)
  })

  /** Locks the bucket row from another connection, runs `whileHeld`, then commits the holder. */
  async function withRowLockHeld(whileHeld: () => Promise<void>): Promise<void> {
    let held: () => void = () => {}
    let release: () => void = () => {}
    const acquired = new Promise<void>((resolve) => {
      held = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const holder = db.transaction(async (tx) => {
      await tx.select().from(rateLimitBucket).where(eq(rateLimitBucket.key, key)).for('update')
      held()
      await released
    })
    await acquired
    try {
      await whileHeld()
    } finally {
      release()
      await holder
    }
  }

  /**
   * Starts an admission and resolves once it is queued behind the held row lock. The result is
   * wrapped so awaiting this does not also await the blocked admission.
   */
  async function queuedBehindLock(
    admit: () => Promise<AtomicAdmissionResult>
  ): Promise<{ result: Promise<AtomicAdmissionResult> }> {
    const result = admit()
    result.catch(() => {})
    await sleep(300)
    return { result }
  }

  async function storedTokens(): Promise<number> {
    const [row] = await db
      .select({ tokens: rateLimitBucket.tokens })
      .from(rateLimitBucket)
      .where(eq(rateLimitBucket.key, key))
    return Number(row?.tokens)
  }

  it('refills the time spent waiting for the lock and measures the wait from then', async () => {
    const reservation = {
      key,
      cost: 2,
      config: { maxTokens: 2, refillRate: 1, refillIntervalMs: 1000 },
    }
    const options = { cooldownKeys: [], deadlineAt: now + 60_000 }
    expect(await bucket.consumeTokensAtomically([reservation], options)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    })
    let denied: { result: Promise<AtomicAdmissionResult> } | undefined
    await withRowLockHeld(async () => {
      denied = await queuedBehindLock(() => bucket.consumeTokensAtomically([reservation], options))
      await sleep(LOCK_HOLD_MS - 300)
    })
    const result = await denied?.result
    expect(result?.allowed).toBe(false)
    expect(result?.retryAfterMs).toBeGreaterThan(0)
    expect(result?.retryAfterMs).toBeLessThan(1000)

    let admitted: { result: Promise<AtomicAdmissionResult> } | undefined
    await withRowLockHeld(async () => {
      admitted = await queuedBehindLock(() =>
        bucket.consumeTokensAtomically([{ ...reservation, cost: 1 }], options)
      )
      await sleep(LOCK_HOLD_MS - 300)
    })
    expect(await admitted?.result).toEqual({ allowed: true, retryAfterMs: 0 })
  })

  it.each(['deadline', 'abort'] as const)(
    'rolls back a spend whose %s arrives while the statement runs',
    async (interruption) => {
      const reservation = {
        key,
        cost: 5,
        config: { maxTokens: 10, refillRate: 1, refillIntervalMs: 600_000 },
      }
      expect(
        await bucket.consumeTokensAtomically([{ ...reservation, cost: 0 }], {
          cooldownKeys: [],
          deadlineAt: now + 60_000,
        })
      ).toEqual({ allowed: true, retryAfterMs: 0 })
      const controller = new AbortController()
      let pending: { result: Promise<AtomicAdmissionResult> } | undefined
      await withRowLockHeld(async () => {
        pending = await queuedBehindLock(() =>
          bucket.consumeTokensAtomically([reservation], {
            cooldownKeys: [],
            deadlineAt: now + 5000,
            signal: controller.signal,
          })
        )
        if (interruption === 'deadline') vi.setSystemTime(now + 6000)
        else controller.abort(new Error('cancelled'))
      })
      if (interruption === 'deadline') {
        expect(await pending?.result).toEqual({ allowed: false, retryAfterMs: 0 })
      } else {
        await expect(pending?.result).rejects.toThrow('cancelled')
      }
      expect(await storedTokens()).toBe(10)
    }
  )
})
