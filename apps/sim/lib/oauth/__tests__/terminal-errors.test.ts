/**
 * @vitest-environment node
 */
import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import {
  clearDeadFlag,
  getRecentTerminalError,
  isTerminalRefreshError,
  markCredentialDead,
} from '@/lib/oauth/terminal-errors'

interface FakeRedis {
  store: Map<string, string>
  set: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
}

function createFakeRedis(): FakeRedis {
  const store = new Map<string, string>()
  return {
    store,
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
})

describe('isTerminalRefreshError', () => {
  it.each([
    'invalid_refresh_token',
    'invalid_grant',
    'access_denied',
    'bad_client_secret',
    'invalid_client_id',
    'invalid_client',
    'bad_redirect_uri',
  ])('returns true for %s', (code) => {
    expect(isTerminalRefreshError(code)).toBe(true)
  })

  it.each(['ratelimited', 'internal_error', 'service_unavailable', undefined, null, ''])(
    'returns false for %s',
    (code) => {
      expect(isTerminalRefreshError(code as string | undefined | null)).toBe(false)
    }
  )
})

describe('markCredentialDead / getRecentTerminalError / clearDeadFlag', () => {
  it('roundtrips a code through Redis', async () => {
    const redis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)

    await markCredentialDead('acc-1', 'invalid_refresh_token')
    expect(await getRecentTerminalError('acc-1')).toBe('invalid_refresh_token')
  })

  it('clearDeadFlag removes the entry', async () => {
    const redis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)

    await markCredentialDead('acc-1', 'invalid_refresh_token')
    await clearDeadFlag('acc-1')
    expect(await getRecentTerminalError('acc-1')).toBeNull()
  })

  it('all functions are no-ops when Redis is unavailable', async () => {
    await expect(markCredentialDead('acc-1', 'code')).resolves.toBeUndefined()
    await expect(getRecentTerminalError('acc-1')).resolves.toBeNull()
    await expect(clearDeadFlag('acc-1')).resolves.toBeUndefined()
  })

  it('absorbs Redis errors without throwing', async () => {
    const redis = createFakeRedis()
    redis.set.mockRejectedValueOnce(new Error('boom'))
    redis.get.mockRejectedValueOnce(new Error('boom'))
    redis.del.mockRejectedValueOnce(new Error('boom'))
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)

    await expect(markCredentialDead('acc-1', 'code')).resolves.toBeUndefined()
    await expect(getRecentTerminalError('acc-1')).resolves.toBeNull()
    await expect(clearDeadFlag('acc-1')).resolves.toBeUndefined()
  })

  it('uses a 1-hour TTL on the dead flag', async () => {
    const redis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)

    await markCredentialDead('acc-1', 'invalid_refresh_token')
    expect(redis.set).toHaveBeenCalledWith('oauth:dead:acc-1', 'invalid_refresh_token', 'EX', 3600)
  })
})
