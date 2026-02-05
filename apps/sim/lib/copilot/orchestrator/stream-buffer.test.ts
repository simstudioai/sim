/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

type StoredEntry = { score: number; value: string }

const createRedisStub = () => {
  const events = new Map<string, StoredEntry[]>()
  const counters = new Map<string, number>()

  const readEntries = (key: string, min: number, max: number) => {
    const list = events.get(key) || []
    return list
      .filter((entry) => entry.score >= min && entry.score <= max)
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.value)
  }

  return {
    del: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue({}),
    expire: vi.fn().mockResolvedValue(1),
    eval: vi
      .fn()
      .mockImplementation(
        (
          _lua: string,
          _keysCount: number,
          seqKey: string,
          eventsKey: string,
          _ttl: number,
          _limit: number,
          streamId: string,
          eventJson: string
        ) => {
          const current = counters.get(seqKey) || 0
          const next = current + 1
          counters.set(seqKey, next)
          const entry = JSON.stringify({ eventId: next, streamId, event: JSON.parse(eventJson) })
          const list = events.get(eventsKey) || []
          list.push({ score: next, value: entry })
          events.set(eventsKey, list)
          return next
        }
      ),
    incrby: vi.fn().mockImplementation((key: string, amount: number) => {
      const current = counters.get(key) || 0
      const next = current + amount
      counters.set(key, next)
      return next
    }),
    zrangebyscore: vi.fn().mockImplementation((key: string, min: string, max: string) => {
      const minVal = Number(min)
      const maxVal = max === '+inf' ? Number.POSITIVE_INFINITY : Number(max)
      return Promise.resolve(readEntries(key, minVal, maxVal))
    }),
    pipeline: vi.fn().mockImplementation(() => {
      const api: Record<string, any> = {}
      api.zadd = vi.fn().mockImplementation((key: string, ...args: Array<string | number>) => {
        const list = events.get(key) || []
        for (let i = 0; i < args.length; i += 2) {
          list.push({ score: Number(args[i]), value: String(args[i + 1]) })
        }
        events.set(key, list)
        return api
      })
      api.expire = vi.fn().mockReturnValue(api)
      api.zremrangebyrank = vi.fn().mockReturnValue(api)
      api.exec = vi.fn().mockResolvedValue([])
      return api
    }),
  }
}

let mockRedis: ReturnType<typeof createRedisStub>

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => mockRedis,
}))

import {
  appendStreamEvent,
  createStreamEventWriter,
  readStreamEvents,
} from '@/lib/copilot/orchestrator/stream-buffer'

describe('stream-buffer', () => {
  beforeEach(() => {
    mockRedis = createRedisStub()
    vi.clearAllMocks()
  })

  it.concurrent('replays events after a given event id', async () => {
    await appendStreamEvent('stream-1', { type: 'content', data: 'hello' })
    await appendStreamEvent('stream-1', { type: 'content', data: 'world' })

    const allEvents = await readStreamEvents('stream-1', 0)
    expect(allEvents.map((entry) => entry.event.data)).toEqual(['hello', 'world'])

    const replayed = await readStreamEvents('stream-1', 1)
    expect(replayed.map((entry) => entry.event.data)).toEqual(['world'])
  })

  it.concurrent('flushes buffered events for resume', async () => {
    const writer = createStreamEventWriter('stream-2')
    await writer.write({ type: 'content', data: 'a' })
    await writer.write({ type: 'content', data: 'b' })
    await writer.flush()

    const events = await readStreamEvents('stream-2', 0)
    expect(events.map((entry) => entry.event.data)).toEqual(['a', 'b'])
  })
})
