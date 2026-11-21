import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { reconnectCallbacks } = vi.hoisted(() => ({
  reconnectCallbacks: [] as Array<() => void>,
}))

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient
const mockOnRedisReconnect = redisConfigMockFns.mockOnRedisReconnect

vi.mock('@/lib/core/rate-limiter/storage/redis-token-bucket', () => ({
  RedisTokenBucket: vi.fn().mockImplementation(
    class {
      constructor(readonly redis: unknown) {}
    }
  ),
}))

import { createStorageAdapter, resetStorageAdapter } from '@/lib/core/rate-limiter/storage/factory'

describe('rate limit storage factory', () => {
  beforeEach(() => {
    mockOnRedisReconnect.mockImplementation((cb: () => void) => {
      reconnectCallbacks.push(cb)
    })
    resetStorageAdapter()
  })

  it('surfaces a missing Redis configuration instead of falling back to another backend', () => {
    mockGetRedisClient.mockImplementationOnce(() => {
      throw new Error('REDIS_URL is required')
    })

    expect(() => createStorageAdapter()).toThrow('REDIS_URL is required')

    const recovered = { ping: vi.fn() }
    mockGetRedisClient.mockReturnValue(recovered)
    expect(createStorageAdapter()).toMatchObject({ redis: recovered })
  })

  it('rebuilds the adapter against the replacement client after a forced reconnect', () => {
    const first = { ping: vi.fn() }
    mockGetRedisClient.mockReturnValue(first)
    expect(createStorageAdapter()).toMatchObject({ redis: first })

    const replacement = { ping: vi.fn() }
    mockGetRedisClient.mockReturnValue(replacement)
    expect(createStorageAdapter()).toMatchObject({ redis: first })

    reconnectCallbacks[reconnectCallbacks.length - 1]()
    expect(createStorageAdapter()).toMatchObject({ redis: replacement })
  })
})
