import { EventEmitter } from 'node:events'
import { redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clients } = vi.hoisted(() => ({
  clients: [] as Array<EventEmitter & { subscribed: Array<(err: Error | null) => void> }>,
}))

vi.mock('ioredis', () => ({
  default: class extends EventEmitter {
    subscribed: Array<(err: Error | null) => void> = []

    constructor() {
      super()
      clients.push(this)
    }

    subscribe(_channel: string, done: (err: Error | null) => void) {
      this.subscribed.push(done)
    }

    publish = vi.fn(async () => 1)
    unsubscribe = vi.fn(async () => undefined)
    quit = vi.fn(async () => 'OK')
  },
}))

import { createPubSubChannel } from '@/lib/events/pubsub'

/** Whether the promise has settled by the time already-queued work runs. */
async function settled(promise: Promise<void>): Promise<boolean> {
  return Promise.race([promise.then(() => true), Promise.resolve().then(() => false)])
}

/** The subscriber connection: the channel opens its publisher first. */
function subscriber() {
  const client = clients.at(-1)
  if (!client) throw new Error('no Redis client')
  return client
}

describe('createPubSubChannel over Redis', () => {
  beforeEach(() => {
    clients.length = 0
    redisConfigMockFns.mockGetConfiguredRedisUrl.mockReturnValue('redis://localhost:6379')
  })

  it('is ready only once its connection has subscribed', async () => {
    const channel = createPubSubChannel({ channel: 'test', label: 'Test' })
    expect(await settled(channel.ready())).toBe(false)

    subscriber().emit('ready')
    expect(await settled(channel.ready())).toBe(false)

    subscriber().subscribed[0](null)
    expect(await settled(channel.ready())).toBe(true)
  })

  it('is not ready again until a dropped connection has resubscribed', async () => {
    const channel = createPubSubChannel({ channel: 'test', label: 'Test' })
    subscriber().emit('ready')
    subscriber().subscribed[0](null)

    subscriber().emit('close')
    expect(await settled(channel.ready())).toBe(false)

    subscriber().emit('ready')
    subscriber().subscribed[1](null)
    expect(await settled(channel.ready())).toBe(true)
  })

  it('is not ready while its subscribe fails, and retries on the next connection', async () => {
    const channel = createPubSubChannel({ channel: 'test', label: 'Test' })
    subscriber().emit('ready')

    subscriber().subscribed[0](new Error('NOPERM'))
    expect(await settled(channel.ready())).toBe(false)

    subscriber().emit('close')
    subscriber().emit('ready')
    subscriber().subscribed[1](null)
    expect(await settled(channel.ready())).toBe(true)
  })

  it('ignores a subscribe answered after its connection closed', async () => {
    const channel = createPubSubChannel({ channel: 'test', label: 'Test' })
    subscriber().emit('ready')

    subscriber().emit('close')
    subscriber().subscribed[0](null)
    expect(await settled(channel.ready())).toBe(false)

    subscriber().emit('ready')
    subscriber().subscribed[1](null)
    expect(await settled(channel.ready())).toBe(true)
  })
})
