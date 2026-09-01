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
  describeRedisConnection,
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
    mockRedisInstance.status = 'ready'
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

  describe('describeRedisConnection', () => {
    it('reports no client before one is built', () => {
      const d = describeRedisConnection()

      expect(d.status).toBe('no-client')
      expect(d.clientAgeMs).toBeNull()
      expect(d.readyAgeMs).toBeNull()
      expect(d.connects).toBe(0)
    })

    it('separates a connecting client from a ready one', () => {
      // The constructor copies the mock's fields, so each state has to be set
      // before the client is built.
      mockRedisInstance.status = 'connecting'
      getRedisClient()
      expect(describeRedisConnection().status).toBe('connecting')

      resetForTesting()
      mockRedisInstance.status = 'ready'
      getRedisClient()
      expect(describeRedisConnection().status).toBe('ready')
    })

    it('counts lifecycle events so a reconnect is distinguishable from a first connect', async () => {
      getRedisClient()
      const handler = (event: string) =>
        mockRedisInstance.on.mock.calls.find((c: unknown[]) => c[0] === event)?.[1] as
          | (() => void)
          | undefined

      handler('connect')?.()
      handler('ready')?.()
      const afterConnect = describeRedisConnection()
      expect(afterConnect.connects).toBe(1)
      expect(afterConnect.readyAgeMs).not.toBeNull()

      const errorHandler = mockRedisInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'error'
      )?.[1] as ((e: Error) => void) | undefined
      errorHandler?.(new Error('ECONNRESET'))

      const afterError = describeRedisConnection()
      expect(afterError.errors).toBe(1)
      expect(afterError.lastErrorMessage).toBe('ECONNRESET')
    })

    it('classifies the host without ever exposing the URL that carries the auth token', () => {
      mockEnv.REDIS_URL = 'rediss://10.0.0.5:6379'
      mockEnv.REDIS_TLS_SERVERNAME = 'primary.example.cache.amazonaws.com'

      const d = describeRedisConnection()

      expect(d).toMatchObject({ hostKind: 'ip', tls: true, sniOverride: true })
      expect(JSON.stringify(d)).not.toContain('10.0.0.5')
    })

    it('never throws, so it cannot mask the error it is describing', () => {
      // Called from catch blocks: a throw here would replace the real failure.
      mockEnv.REDIS_URL = undefined
      expect(() => describeRedisConnection()).not.toThrow()

      mockEnv.REDIS_URL = 'not a url'
      expect(() => describeRedisConnection()).not.toThrow()
      expect(describeRedisConnection().hostKind).toBe('unknown')

      // rediss:// to a bare IP with no REDIS_TLS_SERVERNAME makes the URL
      // resolution throw; the snapshot must still come back.
      mockEnv.REDIS_URL = 'rediss://10.0.0.5:6379'
      mockEnv.REDIS_TLS_SERVERNAME = undefined
      expect(() => describeRedisConnection()).not.toThrow()
    })

    it('does not date a connection that has been discarded', async () => {
      mockRedisInstance.status = 'ready'
      getRedisClient()
      expect(describeRedisConnection().clientAgeMs).not.toBeNull()

      // Two consecutive PING failures drop the cached client.
      mockRedisInstance.ping.mockRejectedValue(new Error('ETIMEDOUT'))
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(15_000)

      const d = describeRedisConnection()
      expect(d.status).toBe('no-client')
      expect(d.clientAgeMs).toBeNull()
      expect(d.readyAgeMs).toBeNull()
      expect(d.msSinceLastPingOk).toBeNull()
      // Lifecycle counters stay cumulative for the process.
      expect(d.reconnects).toBeGreaterThanOrEqual(0)
    })

    it('classifies an IPv6 literal as an IP, not a DNS name', () => {
      mockEnv.REDIS_URL = 'rediss://[2600:1f18::1]:6379'

      const d = describeRedisConnection()

      expect(d.hostKind).toBe('ip')
      // Mirrors resolveRedisTlsOptions, which applies the override for IPv4 only.
      expect(d.sniOverride).toBe(false)
    })

    it('reports a DNS host so resolution latency can be ruled in or out', () => {
      mockEnv.REDIS_URL = 'rediss://primary.example.cache.amazonaws.com:6379'

      expect(describeRedisConnection()).toMatchObject({ hostKind: 'dns', sniOverride: false })
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
