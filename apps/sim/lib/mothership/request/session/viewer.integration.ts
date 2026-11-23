/**
 * Chat stream reader presence against real Redis: a reader attached on one instance must be
 * visible to the instance dispatching that turn's workflow tools, and must stop counting the
 * moment it leaves, so a turn nobody reads no longer waits out the full pickup grace.
 */

import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import { hasStreamViewer, holdStreamViewer } from '@/lib/mothership/request/session/viewer'

describe('chat stream reader presence', () => {
  afterAll(async () => {
    await closeRedisConnection()
  })

  it('counts a reader as attached once its hold resolves', async () => {
    const streamId = generateId()
    const release = await holdStreamViewer(streamId)
    try {
      expect(await hasStreamViewer(streamId)).toBe(true)
    } finally {
      release()
    }
  })

  it('sees no reader on a stream nobody attached to', async () => {
    expect(await hasStreamViewer(generateId())).toBe(false)
  })

  it('keeps counting a stream while another reader stays attached', async () => {
    const streamId = generateId()
    const leaving = await holdStreamViewer(streamId)
    const staying = await holdStreamViewer(streamId)
    try {
      leaving()
      await expect.poll(() => hasStreamViewer(streamId)).toBe(true)
    } finally {
      staying()
    }
  })

  it('stops counting a reader as soon as it leaves, and never re-marks it', async () => {
    const streamId = generateId()
    const release = await holdStreamViewer(streamId)
    release()
    await expect.poll(() => hasStreamViewer(streamId)).toBe(false)
    // Longer than one refresh: a reader still refreshing would have re-marked itself by now.
    await sleep(3_500)

    expect(await hasStreamViewer(streamId)).toBe(false)
  })
})
