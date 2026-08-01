/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: { REDIS_URL: undefined } }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => null }))

import {
  appendEvent,
  type EventLogConfig,
  type EventLogEntry,
  getLatestEventId,
  readEventsSince,
  resetEventLogMemoryForTesting,
} from '@/lib/realtime/event-log'

interface TestEntry extends EventLogEntry {
  eventId: number
  streamId: string
  value: string
}

const config: EventLogConfig = { prefix: 'test:stream:', ttlSeconds: 3600, cap: 3, readChunk: 500 }

function serializerFor(streamId: string, value: string) {
  return {
    entryPrefix: '{"eventId":',
    entrySuffix: `,"streamId":${JSON.stringify(streamId)},"value":${JSON.stringify(value)}}`,
    buildEntry: (eventId: number): TestEntry => ({ eventId, streamId, value }),
  }
}

describe('event-log (memory fallback)', () => {
  beforeEach(() => resetEventLogMemoryForTesting())

  it('assigns monotonically increasing event ids', async () => {
    const first = await appendEvent(config, 's1', serializerFor('s1', 'a'))
    const second = await appendEvent(config, 's1', serializerFor('s1', 'b'))
    expect(first?.eventId).toBe(1)
    expect(second?.eventId).toBe(2)
  })

  it('isolates streams by id', async () => {
    await appendEvent(config, 's1', serializerFor('s1', 'a'))
    const other = await appendEvent(config, 's2', serializerFor('s2', 'x'))
    expect(other?.eventId).toBe(1)
    expect(await getLatestEventId(config, 's1')).toBe(1)
    expect(await getLatestEventId(config, 's2')).toBe(1)
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

  it('tails from the latest id and returns nothing for a fresh cursor', async () => {
    await appendEvent(config, 's1', serializerFor('s1', 'a'))
    await appendEvent(config, 's1', serializerFor('s1', 'b'))
    const latest = await getLatestEventId(config, 's1')
    const result = await readEventsSince<TestEntry>(config, 's1', latest)
    expect(result).toEqual({ status: 'ok', events: [] })
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
})
