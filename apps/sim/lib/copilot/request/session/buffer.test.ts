/**
 * @vitest-environment node
 */

import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createEvent } from '@/lib/copilot/request/session/event'
import { getRedisBudgetLimits } from '@/lib/core/redis/byte-budget.server'

type StoredEnvelope = {
  score: number
  value: string
}

const createRedisStub = () => {
  const counters = new Map<string, number>()
  const values = new Map<string, string>()
  const sortedSets = new Map<string, StoredEnvelope[]>()

  const api = {
    incr: vi.fn().mockImplementation((key: string) => {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next
    }),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockImplementation((...keys: string[]) => {
      for (const key of keys) {
        values.delete(key)
        sortedSets.delete(key)
        counters.delete(key)
      }
      return Promise.resolve(keys.length)
    }),
    zadd: vi.fn().mockImplementation((key: string, score: number, value: string) => {
      const entries = sortedSets.get(key) ?? []
      entries.push({ score, value })
      sortedSets.set(key, entries)
      return Promise.resolve(1)
    }),
    zremrangebyrank: vi.fn().mockImplementation((key: string, start: number, stop: number) => {
      const entries = [...(sortedSets.get(key) ?? [])].sort((a, b) => a.score - b.score)
      const normalizedStart = start < 0 ? Math.max(entries.length + start, 0) : start
      const normalizedStop = stop < 0 ? entries.length + stop : stop
      const next = entries.filter(
        (_entry, index) => index < normalizedStart || index > normalizedStop
      )
      sortedSets.set(key, next)
      return Promise.resolve(1)
    }),
    zrangebyscore: vi.fn().mockImplementation((key: string, min: number, max: string) => {
      const upperBound = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max)
      const entries = [...(sortedSets.get(key) ?? [])]
        .filter((entry) => entry.score >= min && entry.score <= upperBound)
        .sort((a, b) => a.score - b.score)
        .map((entry) => entry.value)
      return Promise.resolve(entries)
    }),
    set: vi.fn().mockImplementation((key: string, value: string) => {
      values.set(key, value)
      return Promise.resolve('OK')
    }),
    get: vi.fn().mockImplementation((key: string) => Promise.resolve(values.get(key) ?? null)),
    /**
     * Stands in for `APPEND_EVENTS_SCRIPT`. It reproduces the script's observable
     * effects — dedupe, zadd, rank-trim, seq — so the read-path tests still exercise
     * real data, and exposes `budgetRefusal` so the refusal branch can be driven
     * without reimplementing the budget arithmetic here.
     */
    budgetRefusal: null as null | [number, string, number],
    eval: vi.fn().mockImplementation((...args: unknown[]) => {
      const numKeys = Number(args[1])
      const keys = args.slice(2, 2 + numKeys) as string[]
      const argv = args.slice(2 + numKeys) as Array<string | number>

      if (api.budgetRefusal) return Promise.resolve(api.budgetRefusal)

      const [eventsKey, seqKey] = keys
      const eventLimit = Number(argv[1])
      const lastSeq = String(argv[5])
      const entries = sortedSets.get(eventsKey) ?? []
      for (let i = 6; i < argv.length; i += 2) {
        const score = Number(argv[i])
        const value = String(argv[i + 1])
        if (!entries.some((entry) => entry.value === value)) entries.push({ score, value })
      }
      entries.sort((a, b) => a.score - b.score)
      sortedSets.set(eventsKey, entries.slice(Math.max(0, entries.length - eventLimit)))
      values.set(seqKey, lastSeq)
      return Promise.resolve([1])
    }),
    pipeline: vi.fn().mockImplementation(() => {
      const operations: Array<() => Promise<unknown>> = []
      const pipeline = {
        zadd: (...args: [string, number, string]) => {
          operations.push(() => api.zadd(...args))
          return pipeline
        },
        expire: (...args: [string, number]) => {
          operations.push(() => api.expire(...args))
          return pipeline
        },
        set: (...args: [string, string, 'EX', number]) => {
          operations.push(() => api.set(args[0], args[1]))
          return pipeline
        },
        zremrangebyrank: (...args: [string, number, number]) => {
          operations.push(() => api.zremrangebyrank(...args))
          return pipeline
        },
        exec: vi.fn().mockImplementation(async () => {
          const results: Array<[null, unknown]> = []
          for (const operation of operations) {
            results.push([null, await operation()])
          }
          return results
        }),
      }
      return pipeline
    }),
  }

  return api
}

let mockRedis: ReturnType<typeof createRedisStub>

import {
  allocateCursor,
  appendEvent,
  appendEvents,
  clearBuffer,
  readEvents,
  scheduleBufferCleanup,
} from '@/lib/copilot/request/session/buffer'

async function makeEnvelope(text: string) {
  const cursor = await allocateCursor('stream-1')
  return createEvent({
    streamId: 'stream-1',
    cursor: cursor.cursor,
    seq: cursor.seq,
    requestId: 'req-1',
    type: MothershipStreamV1EventType.text,
    payload: { channel: MothershipStreamV1TextChannel.assistant, text },
  })
}

describe('mothership-stream-outbox', () => {
  beforeEach(() => {
    mockRedis = createRedisStub()
    vi.clearAllMocks()
    redisConfigMockFns.mockGetRedisClient.mockImplementation(() => mockRedis)
  })

  it('replays envelopes after a given cursor', async () => {
    const firstCursor = await allocateCursor('stream-1')
    const secondCursor = await allocateCursor('stream-1')

    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: firstCursor.cursor,
        seq: firstCursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      })
    )
    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: secondCursor.cursor,
        seq: secondCursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'world' },
      })
    )

    const allEvents = await readEvents('stream-1', '0')
    expect(allEvents.map((entry) => entry.payload.text)).toEqual(['hello', 'world'])

    const replayed = await readEvents('stream-1', '1')
    expect(replayed.map((entry) => entry.payload.text)).toEqual(['world'])
  })

  it('trims active stream history to eventLimit on every append', async () => {
    const cursor = await allocateCursor('stream-1')

    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      })
    )

    // KEYS: [events, seq, budgetOwner]; ARGV follows.
    const [, numKeys, eventsKey, seqKey, ownerKey, ...argv] = mockRedis.eval.mock.calls[0]
    expect(numKeys).toBe(3)
    expect(eventsKey).toBe('mothership_stream:stream-1:events')
    expect(seqKey).toBe('mothership_stream:stream-1:seq')
    expect(ownerKey).toBe('execution:redis-budget:copilot_stream:stream-1')
    // ARGV: [ttl, eventLimit, ownerLimit, userLimit, budgetTtl, lastSeq, ...zaddArgs]
    expect(argv[1]).toBe(100_000)
  })

  /**
   * The stream's replay copy is charged to a budget, and a refusal is reported rather
   * than thrown: `flush()` rethrows what it is handed, and that throw reaches the
   * error-path finalize, which would reject a response stream whose bytes the user
   * already received.
   */
  it('reports a budget refusal instead of throwing', async () => {
    const cursor = await allocateCursor('stream-1')
    mockRedis.budgetRefusal = [0, 'owner_redis_bytes', 40_000_000]

    const result = await appendEvents([
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      }),
    ])

    expect(result.persisted).toBe(false)
    if (!result.persisted) {
      expect(result.refusal.resource).toBe('owner_redis_bytes')
      expect(result.refusal.currentBytes).toBe(40_000_000)
    }
  })

  it('refuses a batch past the single-write ceiling without reaching Redis', async () => {
    const cursor = await allocateCursor('stream-1')

    const result = await appendEvents([
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: {
          channel: MothershipStreamV1TextChannel.assistant,
          text: 'x'.repeat(2 * 1024 * 1024),
        },
      }),
    ])

    expect(result.persisted).toBe(false)
    expect(mockRedis.eval).not.toHaveBeenCalled()
  })

  it('charges the user ceiling only when a user is in scope', async () => {
    const cursor = await allocateCursor('stream-1')
    const envelope = createEvent({
      streamId: 'stream-1',
      cursor: cursor.cursor,
      seq: cursor.seq,
      requestId: 'req-1',
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
    })

    await appendEvents([envelope], { streamId: 'stream-1' })
    expect(mockRedis.eval.mock.calls[0][1]).toBe(3)
    expect(mockRedis.eval.mock.calls[0][4]).toBe('execution:redis-budget:copilot_stream:stream-1')

    mockRedis.eval.mockClear()
    await appendEvents([envelope], { streamId: 'stream-1', userId: 'user-1' })
    expect(mockRedis.eval.mock.calls[0][1]).toBe(4)
    expect(mockRedis.eval.mock.calls[0][5]).toBe('execution:redis-budget:user:user-1')
  })

  it('clears persisted stream state during teardown cleanup', async () => {
    const cursor = await allocateCursor('stream-1')

    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      })
    )

    expect((await readEvents('stream-1', '0')).length).toBe(1)

    await clearBuffer('stream-1')

    expect(await readEvents('stream-1', '0')).toEqual([])
  })

  it('shortens completed stream retention without deleting replay data immediately', async () => {
    const cursor = await allocateCursor('stream-1')

    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      })
    )

    await scheduleBufferCleanup('stream-1', 30)

    expect(mockRedis.expire).toHaveBeenCalledWith('mothership_stream:stream-1:events', 30)
    expect(mockRedis.expire).toHaveBeenCalledWith('mothership_stream:stream-1:seq', 30)
    expect(mockRedis.expire).toHaveBeenCalledWith('mothership_stream:stream-1:abort', 30)
    expect((await readEvents('stream-1', '0')).map((entry) => entry.payload.text)).toEqual([
      'hello',
    ])
  })

  it('skips corrupt replay entries that fail stream validation', async () => {
    const cursor = await allocateCursor('stream-1')

    await appendEvent(
      createEvent({
        streamId: 'stream-1',
        cursor: cursor.cursor,
        seq: cursor.seq,
        requestId: 'req-1',
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
      })
    )

    await mockRedis.zadd(
      'mothership_stream:stream-1:events',
      cursor.seq + 1,
      JSON.stringify({
        v: 1,
        type: 'tool',
        seq: cursor.seq + 1,
        ts: '2026-04-11T00:00:00.000Z',
        stream: { streamId: 'stream-1' },
        payload: { toolCallId: 'broken-tool' },
      })
    )

    const replayed = await readEvents('stream-1', '0')

    expect(replayed).toHaveLength(1)
    expect(replayed[0]?.payload.text).toBe('hello')
  })

  it('splits an oversized batch instead of refusing it', async () => {
    const limits = getRedisBudgetLimits('copilot_stream')
    // Individually writable frames that collectively exceed the per-write ceiling. Refusing the
    // whole batch would stop replay persistence for the rest of the stream over a batching artefact.
    const envelopes = await Promise.all(
      Array.from({ length: 3 }, () =>
        makeEnvelope('x'.repeat(Math.floor(limits.maxSingleWriteBytes * 0.45)))
      )
    )

    const result = await appendEvents(envelopes, { streamId: 'stream-1' })

    expect(result.persisted).toBe(true)
    expect(mockRedis.eval).toHaveBeenCalledTimes(2)
  })

  it('refuses a single frame that can never land, without splitting', async () => {
    const limits = getRedisBudgetLimits('copilot_stream')
    const oversized = await makeEnvelope('x'.repeat(limits.maxSingleWriteBytes + 10))
    const result = await appendEvents([oversized], { streamId: 'stream-1' })

    expect(result.persisted).toBe(false)
    expect(mockRedis.eval).not.toHaveBeenCalled()
  })

  it('measures the ceiling in UTF-8 bytes, not UTF-16 units', async () => {
    const limits = getRedisBudgetLimits('copilot_stream')
    // Each astral char is 2 UTF-16 units but 4 UTF-8 bytes, so `String.length` under-reports by 2x
    // and would call this batch writable when Redis will not.
    const chars = Math.floor(limits.maxSingleWriteBytes / 3)
    const astral = await makeEnvelope('\u{1D306}'.repeat(chars))
    expect(JSON.stringify(astral).length).toBeLessThan(limits.maxSingleWriteBytes)

    const result = await appendEvents([astral], { streamId: 'stream-1' })

    expect(result.persisted).toBe(false)
    expect(mockRedis.eval).not.toHaveBeenCalled()
  })

  it('drops the owner counter together with the buffer it accounts for', async () => {
    // The buffer keys are deleted rather than expired, so a counter left behind would refuse a
    // retry that reuses the same streamId against bytes that no longer exist anywhere. One
    // script, so a concurrent append cannot land between the delete and the release and keep
    // its events stored with its reservation already erased.
    await clearBuffer('stream-1')

    // One variadic DEL: a single atomic command, so no script is needed for the counter to go
    // with the data it accounts for.
    expect(mockRedis.del).toHaveBeenCalledTimes(1)
    expect(mockRedis.del.mock.calls[0]).toContain('execution:redis-budget:copilot_stream:stream-1')
  })

  it('never touches the shared user counter when clearing a buffer', async () => {
    // An owner id is not proof of who wrote the bytes, so crediting the user counter here would
    // let anyone who can name a stream decrement a ceiling they never charged.
    await clearBuffer('stream-1')

    const keys = mockRedis.del.mock.calls[0] as string[]
    expect(keys.some((key) => key.includes('redis-budget:user:'))).toBe(false)
  })
})
