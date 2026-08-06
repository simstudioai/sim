import { createMockRedis } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, MockRedisConstructor } = vi.hoisted(() => ({
  mockEnv: {
    REDIS_URL: 'redis://localhost:6379' as string | undefined,
    REDIS_TLS_SERVERNAME: undefined as string | undefined,
  },
  MockRedisConstructor: vi.fn(),
}))

const mockRedisInstance = createMockRedis()
MockRedisConstructor.mockImplementation(
  class {
    constructor() {
      Object.assign(this, mockRedisInstance)
    }
  }
)

vi.unmock('@/lib/core/config/redis')
vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('ioredis', () => ({
  default: MockRedisConstructor,
}))

import {
  closeRedisConnection,
  extendLock,
  getRedisClient,
  onRedisReconnect,
  resetForTesting,
} from '@/lib/core/config/redis'

describe('redis config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetForTesting()
    mockEnv.REDIS_URL = 'redis://localhost:6379'
    mockEnv.REDIS_TLS_SERVERNAME = undefined
    MockRedisConstructor.mockImplementation(
      class {
        constructor() {
          Object.assign(this, mockRedisInstance)
        }
      }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('onRedisReconnect', () => {
    it('should register and invoke reconnect listeners', async () => {
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should not invoke listeners when PINGs succeed', async () => {
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()
      mockRedisInstance.ping.mockResolvedValue('PONG')

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should reset failure count on successful PING', async () => {
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()

      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(15_000)
      mockRedisInstance.ping.mockResolvedValueOnce('PONG')
      await vi.advanceTimersByTimeAsync(15_000)

      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(15_000)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should call disconnect(true) after 2 consecutive PING failures', async () => {
      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)

      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockRedisInstance.disconnect).toHaveBeenCalledWith(true)
    })

    it('should drop the cached client so the next getRedisClient() builds a fresh one', async () => {
      getRedisClient()
      const callsBefore = MockRedisConstructor.mock.calls.length

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(mockRedisInstance.disconnect).toHaveBeenCalledWith(true)

      getRedisClient()
      expect(MockRedisConstructor.mock.calls.length).toBe(callsBefore + 1)
    })

    it('should restart the PING health check against the new client', async () => {
      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(mockRedisInstance.disconnect).toHaveBeenCalledTimes(1)

      getRedisClient()

      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(mockRedisInstance.disconnect).toHaveBeenCalledTimes(2)
    })

    it('should handle listener errors gracefully without breaking health check', async () => {
      const badListener = vi.fn(() => {
        throw new Error('listener crashed')
      })
      const goodListener = vi.fn()
      onRedisReconnect(badListener)
      onRedisReconnect(goodListener)

      getRedisClient()
      mockRedisInstance.ping.mockRejectedValue(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(badListener).toHaveBeenCalledTimes(1)
      expect(goodListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('closeRedisConnection', () => {
    it('should clear the PING interval', async () => {
      getRedisClient()

      mockRedisInstance.quit.mockResolvedValue('OK')
      await closeRedisConnection()

      mockRedisInstance.ping.mockRejectedValue(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(15_000 * 5)
      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()
    })
  })

  describe('extendLock', () => {
    const lockKey = 'copilot:chat-stream-lock:chat-1'
    const value = 'stream-abc'
    const ttlSeconds = 60

    it('returns true when the caller still owns the lock and EXPIRE succeeds', async () => {
      mockRedisInstance.eval.mockResolvedValueOnce(1)

      const extended = await extendLock(lockKey, value, ttlSeconds)

      expect(extended).toBe(true)
      expect(mockRedisInstance.eval).toHaveBeenCalledWith(
        expect.stringContaining('expire'),
        1,
        lockKey,
        value,
        ttlSeconds
      )
    })

    it('returns false when the value does not match (lock owned by another)', async () => {
      mockRedisInstance.eval.mockResolvedValueOnce(0)

      const extended = await extendLock(lockKey, value, ttlSeconds)

      expect(extended).toBe(false)
    })

    it('returns true as a no-op when the cache capability selects the database', async () => {
      mockEnv.REDIS_URL = undefined

      const extended = await extendLock(lockKey, value, ttlSeconds)

      expect(extended).toBe(true)
    })
  })

  describe('capability validation', () => {
    it('rejects a non-Redis URL before constructing a client', () => {
      mockEnv.REDIS_URL = 'https://cache.example.com'

      expect(() => getRedisClient()).toThrow(/valid redis:\/\/ or rediss:\/\/ URL/)
      expect(MockRedisConstructor).not.toHaveBeenCalled()
    })

    it('requires TLS servername for a rediss IP before constructing a client', () => {
      mockEnv.REDIS_URL = 'rediss://10.0.0.1:6379'

      expect(() => getRedisClient()).toThrow(/REDIS_TLS_SERVERNAME is required/)
      expect(MockRedisConstructor).not.toHaveBeenCalled()
    })

    it('passes the configured TLS servername to Redis', () => {
      mockEnv.REDIS_URL = 'rediss://10.0.0.1:6379'
      mockEnv.REDIS_TLS_SERVERNAME = 'cache.example.com'

      getRedisClient()

      expect(MockRedisConstructor).toHaveBeenCalledWith(
        mockEnv.REDIS_URL,
        expect.objectContaining({ tls: { servername: 'cache.example.com' } })
      )
    })
  })

  describe('retryStrategy', () => {
    function captureRetryStrategy(): (times: number) => number {
      let capturedConfig: Record<string, unknown> = {}
      MockRedisConstructor.mockImplementation(
        class {
          constructor(_url: string, config: Record<string, unknown>) {
            capturedConfig = config
            Object.assign(this, { ping: vi.fn(), on: vi.fn() })
          }
        }
      )

      getRedisClient()

      return capturedConfig.retryStrategy as (times: number) => number
    }

    it('should use exponential backoff with jitter', () => {
      const retryStrategy = captureRetryStrategy()
      expect(retryStrategy).toBeDefined()

      const delay1 = retryStrategy(1)
      expect(delay1).toBeGreaterThanOrEqual(1000)
      expect(delay1).toBeLessThanOrEqual(1300)

      const delay3 = retryStrategy(3)
      expect(delay3).toBeGreaterThanOrEqual(4000)
      expect(delay3).toBeLessThanOrEqual(5200)

      const delay5 = retryStrategy(5)
      expect(delay5).toBeGreaterThanOrEqual(10000)
      expect(delay5).toBeLessThanOrEqual(13000)
    })

    it('should cap at 30s for attempts beyond 10', () => {
      const retryStrategy = captureRetryStrategy()
      expect(retryStrategy(11)).toBe(30000)
      expect(retryStrategy(100)).toBe(30000)
    })
  })
})
