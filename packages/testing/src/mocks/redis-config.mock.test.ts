import { afterEach, describe, expect, it } from 'vitest'
import { redisConfigMock, redisConfigMockFns, resetRedisConfigMock } from './redis-config.mock'

describe('redis-config mock', () => {
  afterEach(() => {
    resetRedisConfigMock()
  })

  it('defaults to the Redis-unavailable behavior of the real module', async () => {
    expect(redisConfigMock.getRedisClient()).toBeNull()
    await expect(redisConfigMock.acquireLock('k', 'v', 10)).resolves.toBe(true)
    await expect(redisConfigMock.releaseLock('k', 'v')).resolves.toBe(true)
    await expect(redisConfigMock.extendLock('k', 'v', 10)).resolves.toBe(true)
    await expect(redisConfigMock.closeRedisConnection()).resolves.toBeUndefined()
  })

  it('returns the real connection defaults shape', () => {
    expect(redisConfigMock.getRedisConnectionDefaults('redis://localhost:6379')).toEqual({
      keepAlive: 1000,
      connectTimeout: 10000,
      enableOfflineQueue: true,
    })
  })

  it('resetRedisConfigMock restores defaults after overrides', async () => {
    const fakeClient = { ping: () => 'PONG' }
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(fakeClient)
    redisConfigMockFns.mockAcquireLock.mockResolvedValue(false)
    expect(redisConfigMock.getRedisClient()).toBe(fakeClient)
    await expect(redisConfigMock.acquireLock('k', 'v', 10)).resolves.toBe(false)

    resetRedisConfigMock()
    expect(redisConfigMock.getRedisClient()).toBeNull()
    await expect(redisConfigMock.acquireLock('k', 'v', 10)).resolves.toBe(true)
  })
})
