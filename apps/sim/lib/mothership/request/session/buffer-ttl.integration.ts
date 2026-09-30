/**
 * The replay buffer of a live run against real Redis: it must outlive a park longer
 * than its idle TTL while its controller still holds the chat lock, and a buffer
 * whose numbering restarted must not pass a reconnect cursor off as in range.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

const { redisUrl } = await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  const url = readTestRedisUrl()
  process.env.REDIS_URL = url
  /** Short enough that the park below outlasts it several times over. */
  process.env.COPILOT_STREAM_TTL_SECONDS = '2'
  return { redisUrl: url }
})

import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import {
  acquirePendingChatStream,
  releasePendingChatStream,
  startAbortPoller,
} from '@/lib/mothership/request/session/abort'
import {
  allocateCursor,
  appendEvents,
  getLatestSeq,
  readEvents,
} from '@/lib/mothership/request/session/buffer'
import { createEvent } from '@/lib/mothership/request/session/event'
import { checkForReplayGap } from '@/lib/mothership/request/session/recovery'

async function appendText(streamId: string, text: string): Promise<number> {
  const { seq, cursor } = await allocateCursor(streamId)
  await appendEvents([
    createEvent({
      streamId,
      cursor,
      seq,
      requestId: 'req-ttl',
      type: MothershipStreamV1EventType.text,
      payload: { channel: 'assistant', text },
    }),
  ])
  return seq
}

describe.runIf(Boolean(redisUrl))('replay buffer lifetime', () => {
  afterAll(async () => {
    await closeRedisConnection()
  })

  it('keeps a live run’s buffer through a park longer than its TTL', async () => {
    const chatId = generateId()
    const streamId = generateId()
    expect(await acquirePendingChatStream(chatId, streamId, 0)).toBe(true)
    await appendText(streamId, 'before the park')

    vi.useFakeTimers({ toFake: ['Date'] })
    const poller = startAbortPoller(streamId, new AbortController(), { chatId, pollMs: 50 })
    try {
      for (let tick = 0; tick < 10; tick++) {
        vi.setSystemTime(Date.now() + 21_000)
        await sleep(500)
      }
    } finally {
      clearInterval(poller)
      vi.useRealTimers()
      await releasePendingChatStream(chatId, streamId)
    }

    expect(await getLatestSeq(streamId)).toBe(1)
    expect((await readEvents(streamId, '0')).map((event) => event.seq)).toEqual([1])
    expect(await appendText(streamId, 'after the park')).toBe(2)
  })

  it('reports a gap to a cursor ahead of a buffer whose numbering restarted', async () => {
    const streamId = generateId()
    for (let index = 0; index < 5; index++) await appendText(streamId, `part ${index}`)
    const redis = getRedisClient()!
    await redis.del(`mothership_stream:${streamId}:events`, `mothership_stream:${streamId}:seq`)
    await appendText(streamId, 'after expiry')

    expect(await checkForReplayGap(streamId, '5')).not.toBeNull()
  })
})
