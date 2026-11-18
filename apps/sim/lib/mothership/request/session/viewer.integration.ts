/**
 * Chat stream reader presence against real Redis: a reader attached on one instance must be
 * visible to the instance dispatching that turn's workflow tools, and must stop counting once it
 * leaves, so a turn nobody reads no longer waits out the full pickup grace.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

await vi.hoisted(async () => {
  const { readTestRedisUrl } = await import('@sim/db/testing/test-infrastructure')
  process.env.REDIS_URL = readTestRedisUrl()
})

import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { closeRedisConnection, getRedisClient } from '@/lib/core/config/redis'
import { hasStreamViewer, holdStreamViewer } from '@/lib/mothership/request/session/viewer'

describe('chat stream reader presence', () => {
  afterAll(async () => {
    await closeRedisConnection()
  })

  it('sees a reader attached to the stream', async () => {
    const streamId = generateId()
    const release = holdStreamViewer(streamId)
    try {
      await expect.poll(() => hasStreamViewer(streamId)).toBe(true)
    } finally {
      release()
    }
  })

  it('sees no reader on a stream nobody attached to', async () => {
    expect(await hasStreamViewer(generateId())).toBe(false)
  })

  it('never re-marks a reader after it leaves', async () => {
    const streamId = generateId()
    const release = holdStreamViewer(streamId)
    await expect.poll(() => hasStreamViewer(streamId)).toBe(true)
    release()
    // Stands in for the TTL running out, so the test does not wait it out.
    await getRedisClient()?.del(`mothership_stream:${streamId}:viewer`)
    // Longer than one refresh: a reader still refreshing would have re-marked itself by now.
    await sleep(3_500)

    expect(await hasStreamViewer(streamId)).toBe(false)
  })
})
