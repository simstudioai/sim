/** @vitest-environment node */
import { redisConfigMockFns, resetEnvMock, setEnv } from '@sim/testing'
import { generateId } from '@sim/utils/id'
import Redis from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getRedisBudgetKeys, getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'
import { appendEvents } from '@/lib/mothership/request/session/buffer'
import { createEvent } from '@/lib/mothership/request/session/event'

const redisUrl = process.env.STREAM_REDIS_TEST_URL

/** Real Lua coverage: the unit stub cannot catch byte accounting errors after ring pruning. */
describe.skipIf(!redisUrl)('stream replay byte accounting in Redis', () => {
  let redis: Redis
  const ownedKeys = new Set<string>()

  function scope() {
    const streamId = `stream-budget-test-${generateId()}`
    const userId = `stream-budget-test-${generateId()}`
    const eventsKey = `mothership_stream:${streamId}:events`
    const seqKey = `mothership_stream:${streamId}:seq`
    const budgetKeys = getRedisBudgetKeys({ kind: 'copilot_stream', id: streamId, userId })
    const lease = { key: `stream-budget-test-lock:${generateId()}`, value: generateId() }
    for (const key of [eventsKey, seqKey, ...budgetKeys, lease.key]) ownedKeys.add(key)
    return { streamId, userId, eventsKey, seqKey, budgetKeys, lease }
  }

  function event(streamId: string, seq: number, text: string) {
    return createEvent({
      streamId,
      requestId: 'stream-budget-test',
      seq,
      cursor: String(seq),
      type: 'text',
      payload: { channel: 'assistant', text },
    })
  }

  async function expectExactBudget(current: ReturnType<typeof scope>) {
    const members = await redis.zrange(current.eventsKey, 0, -1)
    const bytes = members.reduce((sum, member) => sum + Buffer.byteLength(member), 0)
    expect(await redis.mget(...current.budgetKeys)).toEqual([String(bytes), String(bytes)])
    return members
  }

  beforeAll(async () => {
    if (!redisUrl) throw new Error('STREAM_REDIS_TEST_URL is required')
    const url = new URL(redisUrl)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('Stream Redis tests require a local instance')
    }
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    })
    await redis.connect()
  })

  beforeEach(() => {
    resetEnvMock()
    setEnv({ COPILOT_STREAM_EVENT_LIMIT: '2' })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
  })

  afterAll(async () => {
    if (redis?.status === 'ready') {
      if (ownedKeys.size > 0) await redis.del(...ownedKeys)
      await redis.quit()
    }
    resetEnvMock()
  })

  it.each([false, true])(
    'charges retained UTF-8 bytes once when a trimmed batch is retried (leased=%s)',
    async (leased) => {
      const current = scope()
      await redis.set(current.lease.key, current.lease.value, 'EX', 60)
      const batch = [
        event(current.streamId, 1, 'a'.repeat(2000)),
        event(current.streamId, 2, '日本語'),
        event(current.streamId, 3, '🛠️'),
      ]
      const lease = leased ? current.lease : undefined
      expect(await appendEvents(batch, current, lease)).toEqual({ persisted: true })
      const first = await expectExactBudget(current)
      expect(first).toHaveLength(2)
      expect(await appendEvents(batch, current, lease)).toEqual({ persisted: true })
      expect(await expectExactBudget(current)).toEqual(first)
      expect(await redis.get(current.seqKey)).toBe('3')
    }
  )

  it('deduplicates a member repeated within one batch', async () => {
    const current = scope()
    const member = event(current.streamId, 1, 'one')
    await appendEvents([member, member], current)
    expect(await expectExactBudget(current)).toHaveLength(1)
  })

  it('prices a mixed replay and new suffix by the actual retained order', async () => {
    const current = scope()
    const batch = [1, 2, 3, 4].map((seq) => event(current.streamId, seq, 'x'.repeat(500 / seq)))
    await appendEvents(batch.slice(0, 3), current)
    await appendEvents([batch[0], batch[2], batch[3]], current)
    expect(await expectExactBudget(current)).toEqual(
      batch.slice(2).map((value) => JSON.stringify(value))
    )
  })

  it.each(['owner', 'user'] as const)(
    'refuses the %s budget atomically without changing the ring or cursor',
    async (kind) => {
      const current = scope()
      await appendEvents([event(current.streamId, 1, 'saved')], current)
      const limits = getRedisBudgetLimits('copilot_stream')
      await redis.set(
        current.budgetKeys[kind === 'owner' ? 0 : 1],
        kind === 'owner' ? limits.maxOwnerBytes : limits.maxUserBytes
      )
      const before = await redis.mget(current.seqKey, ...current.budgetKeys)
      const members = await redis.zrange(current.eventsKey, 0, -1)
      expect(await appendEvents([event(current.streamId, 2, 'refused')], current)).toMatchObject({
        persisted: false,
        refusal: { resource: `${kind}_redis_bytes` },
      })
      expect(await redis.mget(current.seqKey, ...current.budgetKeys)).toEqual(before)
      expect(await redis.zrange(current.eventsKey, 0, -1)).toEqual(members)
    }
  )
})
