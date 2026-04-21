/**
 * @vitest-environment node
 */

import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { createEvent } from '@/lib/copilot/request/session/event'

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

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import {
  allocateCursor,
  appendEvent,
  clearBuffer,
  readEvents,
  scheduleBufferCleanup,
} from '@/lib/copilot/request/session/buffer'

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

  it('does not trim active stream history while appending events', async () => {
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

    expect(mockRedis.zremrangebyrank).not.toHaveBeenCalled()
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
})
