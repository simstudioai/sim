import { createEnvMock, createMockRedis, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockRedisConstructor } = vi.hoisted(() => ({
  MockRedisConstructor: vi.fn(),
}))

const mockRedisInstance = createMockRedis()
MockRedisConstructor.mockImplementation(() => mockRedisInstance)

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/env', () => createEnvMock({ REDIS_URL: 'redis://localhost:6379' }))
vi.mock('ioredis', () => ({
  default: MockRedisConstructor,
}))

describe('redis config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  describe('onRedisReconnect', () => {
    it('should register and invoke reconnect listeners', async () => {
      const { onRedisReconnect, getRedisClient } = await import('@/lib/core/config/redis')
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should not invoke listeners when PINGs succeed', async () => {
      const { onRedisReconnect, getRedisClient } = await import('@/lib/core/config/redis')
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
      const { onRedisReconnect, getRedisClient } = await import('@/lib/core/config/redis')
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
      const { getRedisClient } = await import('@/lib/core/config/redis')
      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)

      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(15_000)
      expect(mockRedisInstance.disconnect).toHaveBeenCalledWith(true)
    })

    it('should handle listener errors gracefully without breaking health check', async () => {
      const { onRedisReconnect, getRedisClient } = await import('@/lib/core/config/redis')
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
      const { getRedisClient, closeRedisConnection } = await import('@/lib/core/config/redis')
      getRedisClient()

      mockRedisInstance.quit.mockResolvedValue('OK')
      await closeRedisConnection()

      mockRedisInstance.ping.mockRejectedValue(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(15_000 * 5)
      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()
    })
  })

  describe('retryStrategy', () => {
    async function captureRetryStrategy(): Promise<(times: number) => number> {
      vi.resetModules()

      let capturedConfig: Record<string, unknown> = {}
      MockRedisConstructor.mockImplementation((_url: string, config: Record<string, unknown>) => {
        capturedConfig = config
        return { ping: vi.fn(), on: vi.fn() }
      })

      const { getRedisClient } = await import('@/lib/core/config/redis')
      getRedisClient()

      return capturedConfig.retryStrategy as (times: number) => number
    }

    it('should use exponential backoff with jitter', async () => {
      const retryStrategy = await captureRetryStrategy()
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

    it('should cap at 30s for attempts beyond 10', async () => {
      const retryStrategy = await captureRetryStrategy()
      expect(retryStrategy(11)).toBe(30000)
      expect(retryStrategy(100)).toBe(30000)
    })
  })
})
