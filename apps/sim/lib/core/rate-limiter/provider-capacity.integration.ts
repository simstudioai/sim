import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { db } from '@sim/db'
import { rateLimitBucket } from '@sim/db/schema'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { storage, redisClient } = vi.hoisted(() => ({
  storage: { backend: 'database' },
  redisClient: { current: undefined as Redis | undefined },
}))
vi.mock('@/lib/core/storage', () => ({ getStorageMethod: () => storage.backend }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redisClient.current }))

import { PROVIDER_CAPACITY_SCRIPT } from '@/lib/core/rate-limiter/provider-capacity-lua'
import {
  type ProviderCapacityAction,
  type ProviderCapacityConfig,
  type ProviderCapacityState,
  updateProviderCapacity,
} from '@/lib/core/rate-limiter/provider-capacity-state'
import { mutateProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity-store'
import { fetchGitHubWithRetry } from '@/connectors/github/request'

const redisUrl = process.env.KNOWLEDGE_ACL_TEST_REDIS_URL
if (redisUrl) {
  const target = new URL(redisUrl)
  if (
    target.protocol !== 'redis:' ||
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.username ||
    target.password
  ) {
    throw new Error('Provider capacity tests require an explicitly configured local Redis')
  }
}
const CONFIG: ProviderCapacityConfig = {
  requestsPerMinute: 60,
  pagesPerMinute: 1000,
  initialPageTokens: 30,
  maxConcurrent: 2,
  recoveryIntervalMs: 60_000,
  minimumScale: 0.1,
}
const acquire = (leaseId: string, pages = 30): ProviderCapacityAction => ({
  kind: 'acquire',
  leaseId,
  pages,
  leaseDurationMs: 120_000,
})

function initial(
  now: number,
  overrides: Partial<ProviderCapacityState> = {}
): ProviderCapacityState {
  return {
    version: 1,
    scale: 1,
    nextRequestAt: 0,
    pageTokens: 1000,
    refilledAt: now,
    cooldownUntil: 0,
    recoveryAt: now + 60_000,
    leases: [],
    ...overrides,
  }
}

describe.each(['database', 'redis'] as const)('%s weighted provider capacity', (backend) => {
  describe.runIf(backend === 'database' || Boolean(redisUrl))('real atomic storage', () => {
    let key: string

    beforeAll(async () => {
      if (backend === 'redis') {
        redisClient.current = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0 })
        await redisClient.current.connect()
      }
    })
    beforeEach(() => {
      storage.backend = backend
      key = `provider-capacity-test:${generateId()}`
    })
    afterEach(async () => {
      vi.unstubAllGlobals()
      if (backend === 'redis') await redisClient.current?.del(`ratelimit:tb:${key}`)
      else await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, key))
    })
    afterAll(async () => {
      await redisClient.current?.quit()
      redisClient.current = undefined
    })

    async function readClock(): Promise<number> {
      if (backend === 'redis') {
        const [seconds, microseconds] = await redisClient.current!.time()
        return Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000)
      }
      const clock = await db.execute<{ now: string }>(
        sql`SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint AS now`
      )
      return Number(clock[0]?.now)
    }

    async function seed(state: ProviderCapacityState) {
      if (backend === 'redis') {
        await redisClient.current!.hset(
          `ratelimit:tb:${key}`,
          'capacityState',
          JSON.stringify(state)
        )
      } else {
        await db
          .insert(rateLimitBucket)
          .values({ key, tokens: '0', lastRefillAt: new Date(), capacityState: state })
          .onConflictDoUpdate({ target: rateLimitBucket.key, set: { capacityState: state } })
      }
    }
    async function read(): Promise<ProviderCapacityState> {
      if (backend === 'redis') {
        const state: ProviderCapacityState = JSON.parse(
          (await redisClient.current!.hget(`ratelimit:tb:${key}`, 'capacityState'))!
        )
        if (!Array.isArray(state.leases)) state.leases = []
        if (!Array.isArray(state.pageWindow)) state.pageWindow = []
        return state
      }
      const [row] = await db
        .select({ state: rateLimitBucket.capacityState })
        .from(rateLimitBucket)
        .where(eq(rateLimitBucket.key, key))
      return row!.state as ProviderCapacityState
    }
    const mutate = (action: ProviderCapacityAction, config = CONFIG) =>
      mutateProviderCapacity(key, config, action, Date.now() + 10_000)

    async function acquireThroughPacing(
      leaseId: string,
      pages: number,
      config: ProviderCapacityConfig
    ) {
      for (let attempt = 0; ; attempt++) {
        const result = await mutate(acquire(leaseId, pages), config)
        if (result.allowed || result.retryAfterMs >= 10 || attempt >= 40) return result
        await interruptibleSleep(Math.max(1, result.retryAfterMs))
      }
    }

    it('defers unusably slow quota pacing until reset rather than consuming repeated bootstrap requests', async () => {
      const now = await readClock()
      await seed(initial(now, { requestQuota: { remaining: 10, resetAt: now + 3_600_000 } }))
      const result = await mutate(acquire('low-quota', 1), {
        ...CONFIG,
        maximumQuotaPacingMs: 120_000,
      })
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeGreaterThan(3_590_000)
      expect((await read()).requestQuota?.remaining).toBe(10)
    })

    it('matches the pure state machine for weighted admission, cooldown, recovery, expiry, and duplicate release', async () => {
      const now = await readClock()
      const second = Math.floor(now / 1000) * 1000
      const cases: Array<{ state: ProviderCapacityState; action: ProviderCapacityAction }> = [
        {
          state: initial(now, { requestQuota: { remaining: 100, resetAt: now + 3_600_000 } }),
          action: acquire('with-quota', 1),
        },
        {
          state: initial(now, { requestQuota: { remaining: 0, resetAt: now + 3_600_000 } }),
          action: acquire('exhausted-quota', 1),
        },
        {
          state: initial(now, { requestQuota: { remaining: 0, resetAt: now - 1 } }),
          action: acquire('reset-quota', 1),
        },
        {
          state: initial(now, { leases: [{ id: 'first', expiresAt: now + 120_000 }] }),
          action: {
            kind: 'settle',
            leaseId: 'first',
            outcome: 'success',
            requestQuota: { remaining: 100, resetAt: now + 3_600_000 },
          },
        },
        {
          state: initial(now, {
            requestQuota: { remaining: 5, resetAt: now + 3_600_000 },
            leases: [{ id: 'first', expiresAt: now + 120_000 }],
          }),
          action: {
            kind: 'settle',
            leaseId: 'first',
            outcome: 'success',
            requestQuota: { remaining: 10, resetAt: now + 3_600_000 },
          },
        },
        { state: initial(now), action: acquire('first') },
        { state: initial(now, { scale: 0.55 }), action: acquire('scaled') },
        {
          state: initial(now, { pageWindow: [{ at: second, pages: 990 }] }),
          action: acquire('rolling-blocked'),
        },
        {
          state: initial(now, { pageWindow: [{ at: second, pages: 100 }] }),
          action: acquire('same-second'),
        },
        {
          state: initial(now, { pageWindow: [{ at: second - 61_000, pages: 1000 }] }),
          action: acquire('expired-window'),
        },
        {
          state: initial(now, {
            pageWindow: [
              { at: second - 3000, pages: 700 },
              { at: second - 2000, pages: 100 },
              { at: second - 1000, pages: 200 },
            ],
          }),
          action: acquire('mixed-window', 750),
        },
        { state: initial(now, { scale: 0.5 }), action: acquire('full-budget', 1000) },
        {
          state: initial(now, { pageTokens: 0, nextRequestAt: now + 1000 }),
          action: acquire('first'),
        },
        {
          state: initial(now, { leases: [{ id: 'first', expiresAt: now + 120_000 }] }),
          action: {
            kind: 'settle',
            leaseId: 'first',
            outcome: 'rate_limit',
            retryAfterMs: 120_000,
          },
        },
        {
          state: initial(now, {
            scale: 0.5,
            cooldownUntil: now + 60_000,
            leases: [{ id: 'first', expiresAt: now + 120_000 }],
          }),
          action: { kind: 'settle', leaseId: 'first', outcome: 'rate_limit', retryAfterMs: 30_000 },
        },
        {
          state: initial(now, {
            scale: 0.5,
            recoveryAt: now - 1,
            leases: [{ id: 'first', expiresAt: now + 120_000 }],
          }),
          action: { kind: 'settle', leaseId: 'first', outcome: 'success' },
        },
        {
          state: initial(now, { leases: [{ id: 'crashed', expiresAt: now - 1 }] }),
          action: acquire('first'),
        },
        {
          state: initial(now),
          action: { kind: 'settle', leaseId: 'absent', outcome: 'rate_limit' },
        },
        { state: initial(now + 60_000), action: acquire('after-clock-rollback') },
        {
          state: initial(now + 60_000, { pageWindow: [{ at: second + 60_000, pages: 1000 }] }),
          action: acquire('rolling-clock-rollback'),
        },
        {
          state: initial(now + 60_000, {
            scale: 0.5,
            recoveryAt: now + 60_000,
            leases: [{ id: 'first', expiresAt: now + 120_000 }],
          }),
          action: { kind: 'settle', leaseId: 'first', outcome: 'success' },
        },
        {
          state: initial(now + 60_000, {
            leases: [{ id: 'first', expiresAt: now + 120_000 }],
          }),
          action: {
            kind: 'settle',
            leaseId: 'first',
            outcome: 'rate_limit',
            retryAfterMs: 120_000,
          },
        },
      ]
      for (const entry of cases) {
        await seed(entry.state)
        const actual = await mutate(entry.action)
        const saved = await read()
        const expected = updateProviderCapacity(entry.state, CONFIG, entry.action, saved.refilledAt)
        expect(actual).toEqual(expected.result)
        expect(saved.pageTokens).toBeCloseTo(expected.state.pageTokens, 7)
        expect({ ...saved, pageTokens: 0 }).toEqual({ ...expected.state, pageTokens: 0 })
      }
    })

    it('admits only the shared page allowance under 40 concurrent workers', async () => {
      const config = {
        ...CONFIG,
        requestsPerMinute: 60_000,
        pagesPerMinute: 60,
        initialPageTokens: 60,
        maxConcurrent: 4,
      }
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => acquireThroughPacing(`worker-${i}`, 30, config))
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(2)
      const state = await read()
      expect(state.pageTokens).toBeGreaterThanOrEqual(0)
      expect(state.leases).toHaveLength(2)
    })

    it('enforces the shared in-flight cap under 40 concurrent workers', async () => {
      const config = {
        ...CONFIG,
        requestsPerMinute: 60_000,
        initialPageTokens: 1000,
        maxConcurrent: 4,
      }
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, i) => acquireThroughPacing(`worker-${i}`, 1, config))
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(4)
      expect((await read()).leases).toHaveLength(4)
    })

    it('smooths request arrivals independently of page allowance', async () => {
      const config = { ...CONFIG, requestsPerMinute: 1, initialPageTokens: 1000, maxConcurrent: 64 }
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => mutate(acquire(`worker-${i}`, 1), config))
      )
      expect(results.filter((result) => result.allowed)).toHaveLength(1)
      expect(
        results.filter((result) => !result.allowed).every((result) => result.retryAfterMs > 50_000)
      ).toBe(true)
    })

    it('releases both concurrent requests, halves once, and preserves the longest throttle hint', async () => {
      const now = await readClock()
      await seed(
        initial(now, {
          leases: [
            { id: 'one', expiresAt: now + 120_000 },
            { id: 'two', expiresAt: now + 120_000 },
          ],
        })
      )
      const results = await Promise.all([
        mutate({ kind: 'settle', leaseId: 'one', outcome: 'rate_limit', retryAfterMs: 60_000 }),
        mutate({ kind: 'settle', leaseId: 'two', outcome: 'rate_limit', retryAfterMs: 120_000 }),
      ])
      expect(results.every((result) => result.scale === 0.5)).toBe(true)
      const state = await read()
      expect(state.leases).toHaveLength(0)
      expect(state.cooldownUntil).toBeGreaterThanOrEqual(now + 120_000)
      expect(await mutate(acquire('third'))).toMatchObject({
        allowed: false,
        scale: 0.5,
        inFlight: 0,
      })
    })

    it('shares successful quota exhaustion and the provider-specific escalating cooldown', async () => {
      const now = await readClock()
      const config = { ...CONFIG, rateLimitBackoffMs: 60_000 }
      await seed(initial(now, { leases: [{ id: 'last', expiresAt: now + 120_000 }] }))
      await mutate(
        {
          kind: 'settle',
          leaseId: 'last',
          outcome: 'success',
          requestQuota: { remaining: 0, resetAt: now + 3_600_000 },
        },
        config
      )
      const waiting = await mutate(acquire('another', 1), config)
      expect(waiting).toMatchObject({ allowed: false, scale: 1, inFlight: 0 })
      expect(waiting.retryAfterMs).toBeGreaterThan(3_500_000)
      await seed(initial(now, { leases: [{ id: 'limited', expiresAt: now + 120_000 }] }))
      expect(
        await mutate({ kind: 'settle', leaseId: 'limited', outcome: 'rate_limit' }, config)
      ).toMatchObject({ scale: 0.5, retryAfterMs: 120_000 })
    })

    it.each(['secondary-throttle', 'successful-exhaustion'] as const)(
      'honors %s through HTTP, shared admission, and a second worker without retrying upstream',
      async (scenario) => {
        const authorization = `Bearer ${generateId()}`
        const scope = createHash('sha256').update(authorization).digest('hex')
        key = `provider:ocr:github-rest:${scope}:capacity:v1`
        let requests = 0
        const server = createServer((_request, response) => {
          requests++
          if (scenario === 'secondary-throttle') {
            response.writeHead(403, { 'content-type': 'application/json' })
            response.end(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }))
          } else {
            response.writeHead(200, {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 3600),
            })
            response.end('complete source content')
          }
        })
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', resolve)
        })
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Missing local fixture port')
        const actualFetch = globalThis.fetch
        vi.stubGlobal('fetch', (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          actualFetch(`http://127.0.0.1:${address.port}`, init)
        )
        try {
          const request = () =>
            fetchGitHubWithRetry('https://api.github.com/repos/example/repo/git/blobs/blob', {
              headers: { Authorization: authorization },
            })
          if (scenario === 'secondary-throttle') {
            await expect(request()).rejects.toMatchObject({
              rateLimited: true,
              retryAfterMs: 120_000,
            })
          } else {
            expect(await (await request()).text()).toBe('complete source content')
          }
          await expect(request()).rejects.toMatchObject({ rateLimited: true })
          expect(requests).toBe(1)
          const saved = await read()
          expect(saved.leases).toHaveLength(0)
          if (scenario === 'successful-exhaustion') {
            expect(saved.requestQuota?.remaining).toBe(0)
            expect(saved.scale).toBe(1)
          } else {
            expect(saved.scale).toBe(0.5)
          }
        } finally {
          server.closeAllConnections()
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
        }
      }
    )

    it.runIf(backend === 'redis')(
      'rejects a stale queued Redis command before creating any reservation',
      async () => {
        const cutoff = (await readClock()) - 1
        await expect(
          redisClient.current!.eval(
            PROVIDER_CAPACITY_SCRIPT,
            1,
            `ratelimit:tb:${key}`,
            JSON.stringify(CONFIG),
            JSON.stringify(acquire('late')),
            String(cutoff)
          )
        ).rejects.toThrow('storage deadline expired')
        expect(await redisClient.current!.exists(`ratelimit:tb:${key}`)).toBe(0)
      }
    )

    it.runIf(backend === 'redis')(
      'retains state longer than every live lease and cooldown',
      async () => {
        await mutate(acquire('first'))
        expect(await redisClient.current!.pttl(`ratelimit:tb:${key}`)).toBeGreaterThan(86_500_000)
      }
    )
  })
})
