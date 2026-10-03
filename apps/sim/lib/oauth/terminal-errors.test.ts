import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOAuthRefreshDeadFlag,
  getOAuthRefreshCoordinationIdentity,
} from '@/lib/oauth/refresh-coordination'
import {
  clearDeadFlag,
  getRecentTerminalError,
  isCredentialRevocationError,
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
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
})

describe('isTerminalRefreshError', () => {
  it('treats a revoked refresh token as terminal but not a transient failure', () => {
    expect(isTerminalRefreshError('invalid_grant')).toBe(true)
    expect(isTerminalRefreshError('service_unavailable')).toBe(false)
    expect(isTerminalRefreshError(undefined)).toBe(false)
  })

  it.each([undefined, 'microsoft', '__proto__'])(
    'treats unauthorized_client as terminal only for Atlassian, not %s',
    (providerId) => {
      expect(isTerminalRefreshError('unauthorized_client', 'confluence')).toBe(true)
      expect(isTerminalRefreshError('unauthorized_client', providerId)).toBe(false)
    }
  )
})

describe('isCredentialRevocationError', () => {
  it('treats an app-registration fault as terminal but not a revocation', () => {
    expect(isTerminalRefreshError('invalid_client', 'confluence')).toBe(true)
    expect(isCredentialRevocationError('invalid_client', 'confluence')).toBe(false)
    expect(isCredentialRevocationError('token_revoked')).toBe(true)
  })

  it.each([undefined, 'microsoft', '__proto__'])(
    'treats unauthorized_client as a revocation only for Atlassian, not %s',
    (providerId) => {
      expect(isCredentialRevocationError('unauthorized_client', 'jira')).toBe(true)
      expect(isCredentialRevocationError('unauthorized_client', providerId)).toBe(false)
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

  it.each(['slack:T08CM6ZNYBE'])(
    'reconnect clears the matching private refresh flag for %s',
    async (scopeKey) => {
      const redis = createFakeRedis()
      redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)
      const identity = getOAuthRefreshCoordinationIdentity(scopeKey)

      await markCredentialDead(identity, 'invalid_refresh_token')
      await clearOAuthRefreshDeadFlag(scopeKey)

      expect(redis.set).toHaveBeenCalledWith(
        `oauth:dead:${identity}`,
        'invalid_refresh_token',
        'EX',
        3600
      )
      expect(redis.del).toHaveBeenCalledWith(`oauth:dead:${identity}`)
      expect(identity).not.toContain(scopeKey)
    }
  )

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
})
