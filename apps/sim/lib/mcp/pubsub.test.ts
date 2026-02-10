/**
 * @vitest-environment node
 */
import { createMockRedis, loggerMock, type MockRedis } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

/** Extend the @sim/testing Redis mock with the methods RedisMcpPubSub uses. */
function createPubSubRedis(): MockRedis & { removeAllListeners: ReturnType<typeof vi.fn> } {
  const mock = createMockRedis()
  // ioredis subscribe invokes a callback as the last argument
  mock.subscribe.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') (cb as (err: null) => void)(null)
  })
  // on() returns `this` for chaining in ioredis
  mock.on.mockReturnThis()
  return { ...mock, removeAllListeners: vi.fn().mockReturnThis() }
}

/** Shared setup: resets modules and applies base mocks. Returns the two Redis instances. */
async function setupPubSub() {
  const instances: ReturnType<typeof createPubSubRedis>[] = []

  vi.resetModules()
  vi.doMock('@sim/logger', () => loggerMock)
  vi.doMock('@/lib/core/config/env', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }))
  vi.doMock('ioredis', () => ({
    default: vi.fn().mockImplementation(() => {
      const instance = createPubSubRedis()
      instances.push(instance)
      return instance
    }),
  }))

  const { mcpPubSub } = await import('./pubsub')
  const [pub, sub] = instances

  return { mcpPubSub, pub, sub, instances }
}

describe('RedisMcpPubSub', () => {
  it('creates two Redis clients (pub and sub)', async () => {
    const { mcpPubSub, instances } = await setupPubSub()

    expect(instances).toHaveLength(2)
    mcpPubSub.dispose()
  })

  it('registers error, connect, and message listeners', async () => {
    const { mcpPubSub, pub, sub } = await setupPubSub()

    const pubEvents = pub.on.mock.calls.map((c: unknown[]) => c[0])
    const subEvents = sub.on.mock.calls.map((c: unknown[]) => c[0])

    expect(pubEvents).toContain('error')
    expect(pubEvents).toContain('connect')
    expect(subEvents).toContain('error')
    expect(subEvents).toContain('connect')
    expect(subEvents).toContain('message')

    mcpPubSub.dispose()
  })

  describe('dispose', () => {
    it('calls removeAllListeners on both pub and sub before quit', async () => {
      const { mcpPubSub, pub, sub } = await setupPubSub()

      mcpPubSub.dispose()

      expect(pub.removeAllListeners).toHaveBeenCalledTimes(1)
      expect(sub.removeAllListeners).toHaveBeenCalledTimes(1)
      expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
      expect(pub.quit).toHaveBeenCalledTimes(1)
      expect(sub.quit).toHaveBeenCalledTimes(1)
    })

    it('drops publish calls after dispose', async () => {
      const { mcpPubSub, pub } = await setupPubSub()

      mcpPubSub.dispose()
      pub.publish.mockClear()

      mcpPubSub.publishToolsChanged({
        serverId: 'srv-1',
        serverName: 'Test',
        workspaceId: 'ws-1',
        timestamp: Date.now(),
      })

      expect(pub.publish).not.toHaveBeenCalled()
    })
  })
})
