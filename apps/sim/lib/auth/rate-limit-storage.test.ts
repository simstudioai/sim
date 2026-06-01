/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetRedisClient, redis } = vi.hoisted(() => {
  const redis = {
    get: vi.fn(),
    set: vi.fn(),
  }
  return { mockGetRedisClient: vi.fn(), redis }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { buildRedisRateLimitStorage } from '@/lib/auth/rate-limit-storage'

describe('buildRedisRateLimitStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedisClient.mockReturnValue(redis)
  })

  it('returns undefined when Redis is not configured (falls back to in-memory)', () => {
    mockGetRedisClient.mockReturnValue(null)
    expect(buildRedisRateLimitStorage()).toBeUndefined()
  })

  it('reads and parses a stored counter', async () => {
    const storage = buildRedisRateLimitStorage()
    redis.get.mockResolvedValue(JSON.stringify({ key: 'k', count: 4, lastRequest: 123 }))
    const value = await storage?.get('k')
    expect(redis.get).toHaveBeenCalledWith('auth-rl:k')
    expect(value).toEqual({ key: 'k', count: 4, lastRequest: 123 })
  })

  it('returns undefined when no counter is stored', async () => {
    const storage = buildRedisRateLimitStorage()
    redis.get.mockResolvedValue(null)
    expect(await storage?.get('missing')).toBeUndefined()
  })

  it('writes the counter with a bounding TTL', async () => {
    const storage = buildRedisRateLimitStorage()
    await storage?.set('k', { key: 'k', count: 1, lastRequest: 999 })
    expect(redis.set).toHaveBeenCalledWith(
      'auth-rl:k',
      JSON.stringify({ key: 'k', count: 1, lastRequest: 999 }),
      'EX',
      3600
    )
  })

  it('fails open on a read error (allows the request)', async () => {
    const storage = buildRedisRateLimitStorage()
    redis.get.mockRejectedValue(new Error('redis down'))
    expect(await storage?.get('k')).toBeUndefined()
  })

  it('swallows write errors so a Redis outage never blocks auth', async () => {
    const storage = buildRedisRateLimitStorage()
    redis.set.mockRejectedValue(new Error('redis down'))
    await expect(storage?.set('k', { key: 'k', count: 1, lastRequest: 1 })).resolves.toBeUndefined()
  })
})
