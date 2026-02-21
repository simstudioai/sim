import { createEnvMock, createMockRedis, loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRedisInstance = createMockRedis()

vi.mock('@sim/logger', () => loggerMock)
vi.mock('@/lib/core/config/env', () => createEnvMock({ REDIS_URL: 'redis://localhost:6379' }))
vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedisInstance),
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
      const { onRedisReconnect, getRedisClient } = await import('./redis')
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should not invoke listeners when PINGs succeed', async () => {
      const { onRedisReconnect, getRedisClient } = await import('./redis')
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()
      mockRedisInstance.ping.mockResolvedValue('PONG')

      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should reset failure count on successful PING', async () => {
      const { onRedisReconnect, getRedisClient } = await import('./redis')
      const listener = vi.fn()
      onRedisReconnect(listener)

      getRedisClient()

      // 2 failures then a success — should reset counter
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000)
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000)
      mockRedisInstance.ping.mockResolvedValueOnce('PONG')
      await vi.advanceTimersByTimeAsync(30_000)

      // 2 more failures — should NOT trigger reconnect (counter was reset)
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000)
      mockRedisInstance.ping.mockRejectedValueOnce(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should call disconnect(true) after 3 consecutive PING failures', async () => {
      const { getRedisClient } = await import('./redis')
      getRedisClient()

      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(mockRedisInstance.disconnect).toHaveBeenCalledWith(true)
    })

    it('should handle listener errors gracefully without breaking health check', async () => {
      const { onRedisReconnect, getRedisClient } = await import('./redis')
      const badListener = vi.fn(() => {
        throw new Error('listener crashed')
      })
      const goodListener = vi.fn()
      onRedisReconnect(badListener)
      onRedisReconnect(goodListener)

      getRedisClient()
      mockRedisInstance.ping.mockRejectedValue(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(badListener).toHaveBeenCalledTimes(1)
      expect(goodListener).toHaveBeenCalledTimes(1)
    })
  })

  describe('closeRedisConnection', () => {
    it('should clear the PING interval', async () => {
      const { getRedisClient, closeRedisConnection } = await import('./redis')
      getRedisClient()

      mockRedisInstance.quit.mockResolvedValue('OK')
      await closeRedisConnection()

      // After closing, PING failures should not trigger disconnect
      mockRedisInstance.ping.mockRejectedValue(new Error('timeout'))
      await vi.advanceTimersByTimeAsync(30_000 * 5)
      expect(mockRedisInstance.disconnect).not.toHaveBeenCalled()
    })
  })

  describe('retryStrategy', () => {
    async function captureRetryStrategy(): Promise<(times: number) => number> {
      vi.resetModules()

      vi.doMock('@sim/logger', () => loggerMock)
      vi.doMock('@/lib/core/config/env', () =>
        createEnvMock({ REDIS_URL: 'redis://localhost:6379' })
      )

      let capturedConfig: Record<string, unknown> = {}
      vi.doMock('ioredis', () => ({
        default: vi.fn((_url: string, config: Record<string, unknown>) => {
          capturedConfig = config
          return { ping: vi.fn(), on: vi.fn() }
        }),
      }))

      const { getRedisClient } = await import('./redis')
      getRedisClient()

      return capturedConfig.retryStrategy as (times: number) => number
    }

    it('should use exponential backoff with jitter', async () => {
      const retryStrategy = await captureRetryStrategy()
      expect(retryStrategy).toBeDefined()

      // Base for attempt 1: min(1000 * 2^0, 10000) = 1000, jitter up to 300
      const delay1 = retryStrategy(1)
      expect(delay1).toBeGreaterThanOrEqual(1000)
      expect(delay1).toBeLessThanOrEqual(1300)

      // Base for attempt 3: min(1000 * 2^2, 10000) = 4000, jitter up to 1200
      const delay3 = retryStrategy(3)
      expect(delay3).toBeGreaterThanOrEqual(4000)
      expect(delay3).toBeLessThanOrEqual(5200)

      // Base for attempt 5: min(1000 * 2^4, 10000) = 10000, jitter up to 3000
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
