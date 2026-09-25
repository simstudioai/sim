import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: { current: null as { eval: ReturnType<typeof vi.fn> } | null },
  mockEnv: {
    REDIS_URL: undefined as string | undefined,
    REDIS_TLS_SERVERNAME: undefined as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => mockRedisClient.current }))

import {
  appendEvent,
  type EventLogConfig,
  type EventLogEntry,
  readEventsSince,
  resetEventLogMemoryForTesting,
} from '@/lib/realtime/event-log'

interface TestEntry extends EventLogEntry {
  eventId: number
  streamId: string
  value: string
}

const config: EventLogConfig = {
  prefix: 'test:stream:',
  ttlSeconds: 3600,
  cap: 3,
  maxBytes: 0,
  readChunk: 500,
}

function serializerFor(streamId: string, value: string) {
  return {
    entryPrefix: '{"eventId":',
    entrySuffix: `,"streamId":${JSON.stringify(streamId)},"value":${JSON.stringify(value)}}`,
    buildEntry: (eventId: number): TestEntry => ({ eventId, streamId, value }),
  }
}

describe('event-log (memory fallback)', () => {
  beforeEach(() => {
    mockEnv.REDIS_URL = undefined
    mockEnv.REDIS_TLS_SERVERNAME = undefined
    mockRedisClient.current = null
    resetEventLogMemoryForTesting()
  })

  it('reads only events after the cursor', async () => {
    await appendEvent(config, 's1', serializerFor('s1', 'a'))
    await appendEvent(config, 's1', serializerFor('s1', 'b'))
    const result = await readEventsSince<TestEntry>(config, 's1', 1)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.events).toHaveLength(1)
      expect(result.events[0].eventId).toBe(2)
      expect(result.events[0].value).toBe('b')
    }
  })

  it('reports pruned when the cursor falls behind the cap-trimmed buffer', async () => {
    // cap = 3; append 5, so the earliest retained id is 3.
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      await appendEvent(config, 's1', serializerFor('s1', v))
    }
    const result = await readEventsSince<TestEntry>(config, 's1', 1)
    expect(result.status).toBe('pruned')
    if (result.status === 'pruned') expect(result.earliestEventId).toBe(3)
  })

  it('reports pruned for a non-zero cursor against a never-seen stream', async () => {
    const result = await readEventsSince<TestEntry>(config, 'missing', 5)
    expect(result.status).toBe('pruned')
  })

  it('does not use memory when Redis is selected but its client is unavailable', async () => {
    mockEnv.REDIS_URL = 'redis://localhost:6379'

    await expect(appendEvent(config, 's1', serializerFor('s1', 'a'))).resolves.toBeNull()
    await expect(readEventsSince<TestEntry>(config, 's1', 0)).resolves.toEqual({
      status: 'unavailable',
      error: 'Redis client unavailable',
    })
  })

  it('fails fast instead of using memory for an invalid Redis configuration', async () => {
    mockEnv.REDIS_URL = 'https://cache.example.com'

    await expect(appendEvent(config, 's1', serializerFor('s1', 'a'))).rejects.toThrow(
      /valid redis:\/\/ or rediss:\/\/ URL/
    )
  })
})

describe('event-log byte ceiling', () => {
  beforeEach(() => {
    mockEnv.REDIS_URL = undefined
    mockEnv.REDIS_TLS_SERVERNAME = undefined
    mockRedisClient.current = null
    resetEventLogMemoryForTesting()
  })

  /**
   * The entry cap is what let one writer hold hundreds of megabytes: `cap` bounds how
   * many entries a stream keeps and nothing about how large each one is.
   */
  it('drops oldest entries once the buffer exceeds maxBytes, under the entry cap', async () => {
    const bounded: EventLogConfig = { ...config, cap: 1000, maxBytes: 400 }
    const big = 'x'.repeat(150)

    for (let i = 0; i < 6; i++) {
      await appendEvent(bounded, 's1', serializerFor('s1', big))
    }

    const fromStart = await readEventsSince<TestEntry>(bounded, 's1', 0)
    expect(fromStart.status).toBe('pruned')
    const earliest = fromStart.status === 'pruned' ? fromStart.earliestEventId : undefined
    expect(earliest).toBeGreaterThan(1)

    const retained = await readEventsSince<TestEntry>(bounded, 's1', (earliest as number) - 1)
    expect(retained.status).toBe('ok')
    const events = retained.status === 'ok' ? retained.events : []
    expect(events.at(-1)?.eventId).toBe(6)
    const bytes = events.reduce((total, e) => total + JSON.stringify(e).length, 0)
    expect(bytes).toBeLessThanOrEqual(400)
  })

  it('keeps the newest entry even when it alone exceeds maxBytes', async () => {
    const bounded: EventLogConfig = { ...config, cap: 1000, maxBytes: 10 }
    await appendEvent(bounded, 's1', serializerFor('s1', 'a'))
    await appendEvent(bounded, 's1', serializerFor('s1', 'b'.repeat(500)))

    const result = await readEventsSince<TestEntry>(bounded, 's1', 1)
    expect(result.status).toBe('ok')
    const events = result.status === 'ok' ? result.events : []
    expect(events).toHaveLength(1)
    expect(events[0]?.eventId).toBe(2)
  })
})
