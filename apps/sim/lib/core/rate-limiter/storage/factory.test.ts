import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, mockOnRedisReconnect, mockGetStorageMethod, reconnectCallbacks } =
  vi.hoisted(() => {
    const callbacks: Array<() => void> = []
    return {
      mockGetRedisClient: vi.fn(() => null),
      mockOnRedisReconnect: vi.fn((cb: () => void) => {
        callbacks.push(cb)
      }),
      mockGetStorageMethod: vi.fn(() => 'db'),
      reconnectCallbacks: callbacks,
    }
  })

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
  onRedisReconnect: mockOnRedisReconnect,
}))

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: mockGetStorageMethod,
}))

vi.mock('@/lib/core/rate-limiter/storage/db-token-bucket', () => ({
  DbTokenBucket: vi.fn(() => ({ type: 'db' })),
}))

vi.mock('@/lib/core/rate-limiter/storage/redis-token-bucket', () => ({
  RedisTokenBucket: vi.fn(() => ({ type: 'redis' })),
}))

import { createStorageAdapter, resetStorageAdapter } from '@/lib/core/rate-limiter/storage/factory'

describe('rate limit storage factory', () => {
  beforeEach(() => {
    mockGetRedisClient.mockReset().mockReturnValue(null)
    mockGetStorageMethod.mockReset().mockReturnValue('db')
    resetStorageAdapter()
  })

  it('should fall back to DbTokenBucket when Redis is configured but client unavailable', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    mockGetRedisClient.mockReturnValue(null)

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'db' })
  })

  it('should use RedisTokenBucket when Redis client is available', () => {
    mockGetStorageMethod.mockReturnValue('redis')
    mockGetRedisClient.mockReturnValue({ ping: vi.fn() } as never)

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'redis' })
  })

  it('should use DbTokenBucket when storage method is db', () => {
    mockGetStorageMethod.mockReturnValue('db')

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'db' })
  })

  it('should cache the adapter and return same instance', () => {
    mockGetStorageMethod.mockReturnValue('db')

    const adapter1 = createStorageAdapter()
    const adapter2 = createStorageAdapter()
    expect(adapter1).toBe(adapter2)
  })

  it('should register a reconnect listener that resets cached adapter', () => {
    mockGetStorageMethod.mockReturnValue('db')

    const adapter1 = createStorageAdapter()

    /** onRedisReconnect is called once (guarded by reconnectListenerRegistered flag). */
    expect(reconnectCallbacks.length).toBeGreaterThan(0)
    const latestCallback = reconnectCallbacks[reconnectCallbacks.length - 1]
    latestCallback()

    const adapter2 = createStorageAdapter()
    expect(adapter2).not.toBe(adapter1)
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
