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
  acquireLock,
  closeRedisConnection,
  extendLock,
  getRedisClient,
  getRedisConnectionDefaults,
  onRedisReconnect,
  REDIS_COMMAND_TIMEOUT_MS,
  resetForTesting,
  warmRedisConnection,
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

  describe('acquireLock', () => {
    const lockKey = 'outlook-polling-lock'
    const value = 'req-abc'
    const ttlSeconds = 180

    it('returns true when SET NX takes the lock', async () => {
      mockRedisInstance.set.mockResolvedValueOnce('OK')

      expect(await acquireLock(lockKey, value, ttlSeconds)).toBe(true)
      expect(mockRedisInstance.set).toHaveBeenCalledWith(lockKey, value, 'EX', ttlSeconds, 'NX')
      expect(mockRedisInstance.eval).not.toHaveBeenCalled()
    })

    it('returns false without cleanup when the lock is already held', async () => {
      mockRedisInstance.set.mockResolvedValueOnce(null)

      expect(await acquireLock(lockKey, value, ttlSeconds)).toBe(false)
      expect(mockRedisInstance.eval).not.toHaveBeenCalled()
    })

    it('reclaims the lock it may have taken when SET times out and reclaim is on', async () => {
      // ioredis gives up client-side on `commandTimeout` while the command can
      // still land, so the lock would otherwise be held by a caller that never
      // learned it won and never releases it.
      mockRedisInstance.set.mockRejectedValueOnce(new Error('Command timed out'))
      mockRedisInstance.eval.mockResolvedValueOnce(1)

      await expect(
        acquireLock(lockKey, value, ttlSeconds, { reclaimOnFailure: true })
      ).rejects.toThrow('Command timed out')
      expect(mockRedisInstance.eval).toHaveBeenCalledWith(
        expect.stringContaining('del'),
        1,
        lockKey,
        value
      )
    })

    it('leaves the lock alone by default so a fall-open caller keeps holding it', async () => {
      // `withLeaderLock` and the MCP OAuth mutex run their work anyway when
      // acquisition throws. Freeing the lock under them would let a second
      // runner in alongside, so reclaiming has to stay opt-in.
      mockRedisInstance.set.mockRejectedValueOnce(new Error('Command timed out'))

      await expect(acquireLock(lockKey, value, ttlSeconds)).rejects.toThrow('Command timed out')
      expect(mockRedisInstance.eval).not.toHaveBeenCalled()
    })

    it('surfaces the original failure when the cleanup also fails', async () => {
      mockRedisInstance.set.mockRejectedValueOnce(new Error('Command timed out'))
      mockRedisInstance.eval.mockRejectedValueOnce(new Error('Connection is closed'))

      // The TTL stays the backstop; the caller must still see why acquiring failed.
      await expect(
        acquireLock(lockKey, value, ttlSeconds, { reclaimOnFailure: true })
      ).rejects.toThrow('Command timed out')
    })

    it('returns true as a no-op when the cache capability selects the database', async () => {
      mockEnv.REDIS_URL = undefined

      expect(await acquireLock(lockKey, value, ttlSeconds)).toBe(true)
      expect(mockRedisInstance.set).not.toHaveBeenCalled()
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

  describe('command timeout', () => {
    it('stays above the connect timeout so a slow handshake is not reported as a command timeout', () => {
      const { connectTimeout } = getRedisConnectionDefaults('redis://localhost:6379')

      expect(connectTimeout).toBeDefined()
      expect(REDIS_COMMAND_TIMEOUT_MS).toBeGreaterThan(connectTimeout as number)
    })

    it('applies that timeout to the shared client', () => {
      getRedisClient()

      expect(MockRedisConstructor).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ commandTimeout: REDIS_COMMAND_TIMEOUT_MS })
      )
    })

    it('does not let the command deadline govern how fast a dead connection is detected', async () => {
      const listener = vi.fn()
      onRedisReconnect(listener)
      getRedisClient()

      // A PING that never settles — the failure mode the health check exists for.
      mockRedisInstance.ping.mockReturnValue(new Promise(() => {}))

      // Two intervals plus two probe deadlines is well under two command
      // deadlines, so this only passes while the probe has its own budget.
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(3 * 15_000).toBeLessThan(2 * REDIS_COMMAND_TIMEOUT_MS + 2 * 15_000)
    })
  })

  describe('warmRedisConnection', () => {
    it('resolves without waiting when the client is already connected', async () => {
      mockRedisInstance.status = 'ready'

      await expect(warmRedisConnection()).resolves.toBeUndefined()
      expect(mockRedisInstance.once).not.toHaveBeenCalled()
    })

    it('resolves once the connection reports ready', async () => {
      mockRedisInstance.status = 'connecting'
      const readyHandlers: Array<() => void> = []
      mockRedisInstance.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'ready') readyHandlers.push(cb)
      })

      let settled = false
      const warm = warmRedisConnection().then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(2_000)
      expect(settled).toBe(false)

      for (const handler of readyHandlers) handler()
      await warm

      expect(settled).toBe(true)
    })

    it('gives up at the connect deadline rather than blocking startup forever', async () => {
      mockRedisInstance.status = 'connecting'
      mockRedisInstance.once.mockImplementation(() => {})

      let settled = false
      const warm = warmRedisConnection().then(() => {
        settled = true
      })

      await vi.advanceTimersByTimeAsync(9_000)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(2_000)
      await warm

      expect(settled).toBe(true)
    })

    it('warms a given client once so a warm process pays nothing per unit of work', async () => {
      mockRedisInstance.status = 'connecting'
      mockRedisInstance.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'ready') cb()
      })

      await warmRedisConnection()
      const callsAfterFirst = mockRedisInstance.once.mock.calls.length

      await warmRedisConnection()

      expect(mockRedisInstance.once.mock.calls.length).toBe(callsAfterFirst)
    })

    it('resolves instead of throwing when Redis is not configured', async () => {
      mockEnv.REDIS_URL = undefined

      await expect(warmRedisConnection()).resolves.toBeUndefined()
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
