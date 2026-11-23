/**
 * The durable event log's Lua append against a real Redis. Readers replay from a cursor and
 * refetch when they fall off the back of the buffer, so each bound the script enforces has to
 * move `earliestEventId` in step with what it drops. Failure modes:
 * - appends mint ids out of order, or a replay returns events at or before the cursor
 * - the entry cap trims without telling a reader behind it that it was pruned
 * - the byte ceiling lets a buffer grow past it while under the entry cap
 * - the byte ceiling drops the newest entry when it alone exceeds the ceiling
 * - a reader with a cursor on an expired or never-seen stream replays nothing instead of refetching
 * - a client tailing from the latest id replays the backlog, or misses the next append
 * Each test uses a fresh stream id; the integration setup flushes Redis per file.
 */
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import {
  appendEvent,
  type EventLogConfig,
  type EventLogEntry,
  getLatestEventId,
  readEventsSince,
} from '@/lib/realtime/event-log'

interface TestEntry extends EventLogEntry {
  streamId: string
  value: string
}

const baseConfig: EventLogConfig = {
  prefix: 'test:event-log:',
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

function freshStream(): string {
  return `stream-${generateShortId()}`
}

async function appendAll(config: EventLogConfig, streamId: string, values: string[]) {
  const appended: Array<TestEntry | null> = []
  for (const value of values) {
    appended.push(await appendEvent(config, streamId, serializerFor(streamId, value)))
  }
  return appended
}

afterAll(async () => {
  await closeRedisConnection()
})

describe('event log over Redis', () => {
  it('mints increasing ids and replays only the events after the cursor, in order', async () => {
    const streamId = freshStream()

    const appended = await appendAll(baseConfig, streamId, ['a', 'b', 'c'])

    expect(appended.map((entry) => entry?.eventId)).toEqual([1, 2, 3])
    await expect(readEventsSince<TestEntry>(baseConfig, streamId, 1)).resolves.toEqual({
      status: 'ok',
      events: [
        { eventId: 2, streamId, value: 'b' },
        { eventId: 3, streamId, value: 'c' },
      ],
    })
  })

  it('trims to the entry cap and reports a cursor behind the trim as pruned', async () => {
    const streamId = freshStream()

    await appendAll(baseConfig, streamId, ['a', 'b', 'c', 'd', 'e'])

    await expect(readEventsSince<TestEntry>(baseConfig, streamId, 0)).resolves.toEqual({
      status: 'pruned',
      earliestEventId: 3,
    })
    await expect(readEventsSince<TestEntry>(baseConfig, streamId, 2)).resolves.toMatchObject({
      status: 'ok',
      events: [{ eventId: 3 }, { eventId: 4 }, { eventId: 5 }],
    })
    expect(await getRedisClient().zcard(`${baseConfig.prefix}${streamId}:events`)).toBe(3)
  })

  it('drops the oldest entries once the buffer exceeds its byte ceiling, under the entry cap', async () => {
    const streamId = freshStream()
    const value = 'x'.repeat(100)
    const entryBytes = Buffer.byteLength(
      `{"eventId":1,"streamId":${JSON.stringify(streamId)},"value":${JSON.stringify(value)}}`
    )
    const config = { ...baseConfig, cap: 100, maxBytes: entryBytes * 2 + 10 }

    await appendAll(config, streamId, [value, value, value, value])

    const result = await readEventsSince<TestEntry>(config, streamId, 2)
    expect(result).toMatchObject({ status: 'ok', events: [{ eventId: 3 }, { eventId: 4 }] })
    await expect(readEventsSince<TestEntry>(config, streamId, 1)).resolves.toEqual({
      status: 'pruned',
      earliestEventId: 3,
    })
    const meta = await getRedisClient().hgetall(`${config.prefix}${streamId}:meta`)
    expect(Number(meta.bytes)).toBeLessThanOrEqual(config.maxBytes)
  })

  it('keeps the newest entry even when it alone exceeds the byte ceiling', async () => {
    const streamId = freshStream()
    const config = { ...baseConfig, cap: 100, maxBytes: 16 }

    await appendAll(config, streamId, ['first', 'x'.repeat(200)])

    await expect(readEventsSince<TestEntry>(config, streamId, 1)).resolves.toMatchObject({
      status: 'ok',
      events: [{ eventId: 2, value: 'x'.repeat(200) }],
    })
  })

  it('reports a non-zero cursor against a stream with no sequence as pruned', async () => {
    await expect(readEventsSince<TestEntry>(baseConfig, freshStream(), 5)).resolves.toEqual({
      status: 'pruned',
      earliestEventId: undefined,
    })
  })

  it('tails from the latest id without replaying the backlog and sees the next append', async () => {
    const streamId = freshStream()
    expect(await getLatestEventId(baseConfig, streamId)).toBe(0)
    await appendAll(baseConfig, streamId, ['a', 'b'])

    const latest = await getLatestEventId(baseConfig, streamId)
    expect(latest).toBe(2)
    await expect(readEventsSince<TestEntry>(baseConfig, streamId, latest)).resolves.toEqual({
      status: 'ok',
      events: [],
    })

    await appendAll(baseConfig, streamId, ['c'])
    await expect(readEventsSince<TestEntry>(baseConfig, streamId, latest)).resolves.toEqual({
      status: 'ok',
      events: [{ eventId: 3, streamId, value: 'c' }],
    })
  })
})
