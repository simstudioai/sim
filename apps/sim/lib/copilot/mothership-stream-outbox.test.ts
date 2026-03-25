/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvelope } from '@/lib/copilot/mothership-stream/envelope'

vi.mock('@sim/logger', () => loggerMock)

type StoredEnvelope = {
  score: number
  value: string
}

const createRedisStub = () => {
  const counters = new Map<string, number>()
  const values = new Map<string, string>()
  const sortedSets = new Map<string, StoredEnvelope[]>()

  return {
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
  }
}

let mockRedis: ReturnType<typeof createRedisStub>

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: () => mockRedis,
}))

import {
  allocateCursor,
  appendEnvelope,
  readEnvelopes,
} from '@/lib/copilot/mothership-stream/outbox'

describe('mothership-stream-outbox', () => {
  beforeEach(() => {
    mockRedis = createRedisStub()
    vi.clearAllMocks()
  })

  it.concurrent('replays envelopes after a given cursor', async () => {
    const firstCursor = await allocateCursor('stream-1')
    const secondCursor = await allocateCursor('stream-1')

    await appendEnvelope(
      createEnvelope({
        streamId: 'stream-1',
        cursor: firstCursor.cursor,
        seq: firstCursor.seq,
        requestId: 'req-1',
        type: 'text',
        payload: { channel: 'assistant', text: 'hello' },
      })
    )
    await appendEnvelope(
      createEnvelope({
        streamId: 'stream-1',
        cursor: secondCursor.cursor,
        seq: secondCursor.seq,
        requestId: 'req-1',
        type: 'text',
        payload: { channel: 'assistant', text: 'world' },
      })
    )

    const allEvents = await readEnvelopes('stream-1', '0')
    expect(allEvents.map((entry) => entry.payload.text)).toEqual(['hello', 'world'])

    const replayed = await readEnvelopes('stream-1', '1')
    expect(replayed.map((entry) => entry.payload.text)).toEqual(['world'])
  })
})
