import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

const reconnectCallbacks: Array<() => void> = []

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: vi.fn(() => null),
  onRedisReconnect: vi.fn((cb: () => void) => {
    reconnectCallbacks.push(cb)
  }),
}))

vi.mock('@/lib/core/storage', () => ({
  getStorageMethod: vi.fn(() => 'db'),
}))

vi.mock('./db-token-bucket', () => ({
  DbTokenBucket: vi.fn(() => ({ type: 'db' })),
}))

vi.mock('./redis-token-bucket', () => ({
  RedisTokenBucket: vi.fn(() => ({ type: 'redis' })),
}))

describe('rate limit storage factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reconnectCallbacks.length = 0
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('should fall back to DbTokenBucket when Redis is configured but client unavailable', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    vi.mocked(getStorageMethod).mockReturnValue('redis')

    const { getRedisClient } = await import('@/lib/core/config/redis')
    vi.mocked(getRedisClient).mockReturnValue(null)

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'db' })
  })

  it('should use RedisTokenBucket when Redis client is available', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    vi.mocked(getStorageMethod).mockReturnValue('redis')

    const { getRedisClient } = await import('@/lib/core/config/redis')
    vi.mocked(getRedisClient).mockReturnValue({ ping: vi.fn() } as never)

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'redis' })
  })

  it('should use DbTokenBucket when storage method is db', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    vi.mocked(getStorageMethod).mockReturnValue('db')

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter = createStorageAdapter()
    expect(adapter).toEqual({ type: 'db' })
  })

  it('should cache the adapter and return same instance', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    vi.mocked(getStorageMethod).mockReturnValue('db')

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter1 = createStorageAdapter()
    const adapter2 = createStorageAdapter()
    expect(adapter1).toBe(adapter2)
  })

  it('should register a reconnect listener that resets cached adapter', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    vi.mocked(getStorageMethod).mockReturnValue('db')

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter1 = createStorageAdapter()

    // Simulate Redis reconnect — should reset cached adapter
    expect(reconnectCallbacks.length).toBeGreaterThan(0)
    reconnectCallbacks[0]()

    // Next call should create a fresh adapter
    const adapter2 = createStorageAdapter()
    expect(adapter2).not.toBe(adapter1)
  })

  it('should re-evaluate storage on next call after reconnect resets cache', async () => {
    const { getStorageMethod } = await import('@/lib/core/storage')
    const { getRedisClient } = await import('@/lib/core/config/redis')

    // Start with Redis unavailable — falls back to DB
    vi.mocked(getStorageMethod).mockReturnValue('redis')
    vi.mocked(getRedisClient).mockReturnValue(null)

    const { createStorageAdapter, resetStorageAdapter } = await import('./factory')
    resetStorageAdapter()

    const adapter1 = createStorageAdapter()
    expect(adapter1).toEqual({ type: 'db' })

    // Simulate reconnect
    reconnectCallbacks[0]()

    // Now Redis is available
    vi.mocked(getRedisClient).mockReturnValue({ ping: vi.fn() } as never)

    const adapter2 = createStorageAdapter()
    expect(adapter2).toEqual({ type: 'redis' })
  })
})
