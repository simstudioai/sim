import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetStorageMethod, reconnectCallbacks } = vi.hoisted(() => {
  const callbacks: Array<() => void> = []
  return {
    mockGetStorageMethod: vi.fn(() => 'db'),
    reconnectCallbacks: callbacks,
  }
})

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient
const mockOnRedisReconnect = redisConfigMockFns.mockOnRedisReconnect

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: mockGetStorageMethod,
}))

vi.mock('@/lib/core/rate-limiter/storage/db-token-bucket', () => ({
  DbTokenBucket: vi.fn().mockImplementation(
    class {
      type = 'db'
    }
  ),
}))

vi.mock('@/lib/core/rate-limiter/storage/redis-token-bucket', () => ({
  RedisTokenBucket: vi.fn().mockImplementation(
    class {
      type = 'redis'
    }
  ),
}))

import { createStorageAdapter, resetStorageAdapter } from '@/lib/core/rate-limiter/storage/factory'

describe('rate limit storage factory', () => {
  beforeEach(() => {
    mockGetRedisClient.mockReset().mockReturnValue(null)
    mockGetStorageMethod.mockReset().mockReturnValue('db')
    mockOnRedisReconnect.mockImplementation((cb: () => void) => {
      reconnectCallbacks.push(cb)
    })
    resetStorageAdapter()
  })

  it('should fall back to DbTokenBucket when Redis is configured but client unavailable', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    mockGetRedisClient.mockReturnValue(null)

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'db' })
  })

  it('provider admission refuses a configured Redis outage instead of opening a second budget', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    expect(createStorageAdapter()).toEqual({ type: 'db' })
    expect(() => createStorageAdapter({ requireConfiguredBackend: true })).toThrow(
      'Configured Redis rate limit storage is unavailable'
    )
  })

  it('strict admission uses recovered Redis even when the ordinary fallback adapter is cached', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    createStorageAdapter()
    mockGetRedisClient.mockReturnValue({ ping: vi.fn() } as never)
    expect(createStorageAdapter({ requireConfiguredBackend: true })).toEqual({ type: 'redis' })
  })

  it('should re-evaluate storage on next call after reconnect resets cache', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    mockGetRedisClient.mockReturnValue(null)

    const adapter1 = createStorageAdapter()
    expect(adapter1).toEqual({ type: 'db' })

    const latestCallback = reconnectCallbacks[reconnectCallbacks.length - 1]
    latestCallback()

    mockGetRedisClient.mockReturnValue({ ping: vi.fn() } as never)

    const adapter2 = createStorageAdapter()
    expect(adapter2).toEqual({ type: 'redis' })
  })
})
