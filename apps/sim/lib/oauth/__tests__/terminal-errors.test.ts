/**
 * @vitest-environment node
 */
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
  vi.clearAllMocks()
  redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
})

describe('isTerminalRefreshError', () => {
  it.each([
    'invalid_refresh_token',
    'bad_refresh_token',
    'invalid_grant',
    'access_denied',
    'bad_client_secret',
    'invalid_client_id',
    'invalid_client',
    'bad_redirect_uri',
    'token_revoked',
  ])('returns true for %s', (code) => {
    expect(isTerminalRefreshError(code)).toBe(true)
  })

  it.each(['confluence', 'jira'])('treats unauthorized_client as terminal for %s', (providerId) => {
    expect(isTerminalRefreshError('unauthorized_client', providerId)).toBe(true)
  })

  it.each([undefined, 'microsoft', 'salesforce', 'google-email', 'constructor', '__proto__'])(
    'does not treat unauthorized_client as terminal for %s',
    (providerId) => {
      expect(isTerminalRefreshError('unauthorized_client', providerId)).toBe(false)
    }
  )

  it.each(['ratelimited', 'internal_error', 'service_unavailable', undefined, null, ''])(
    'returns false for %s',
    (code) => {
      expect(isTerminalRefreshError(code as string | undefined | null)).toBe(false)
    }
  )
})

describe('isCredentialRevocationError', () => {
  it.each([
    'invalid_refresh_token',
    'bad_refresh_token',
    'invalid_grant',
    'access_denied',
    'token_revoked',
  ])('treats %s as a revoked credential', (code) => {
    expect(isCredentialRevocationError(code)).toBe(true)
  })

  it.each(['invalid_client', 'bad_client_secret', 'invalid_client_id', 'bad_redirect_uri'])(
    'treats the app-registration fault %s as terminal but not a revocation',
    (code) => {
      expect(isTerminalRefreshError(code, 'confluence')).toBe(true)
      expect(isCredentialRevocationError(code, 'confluence')).toBe(false)
    }
  )

  it.each(['confluence', 'jira'])(
    'treats unauthorized_client as a revocation for %s',
    (providerId) => {
      expect(isCredentialRevocationError('unauthorized_client', providerId)).toBe(true)
    }
  )

  it.each([undefined, 'microsoft', 'salesforce', 'constructor', '__proto__'])(
    'does not treat unauthorized_client as a revocation for %s',
    (providerId) => {
      expect(isCredentialRevocationError('unauthorized_client', providerId)).toBe(false)
    }
  )

  it.each(['ratelimited', 'internal_error', undefined, null, ''])(
    'returns false for %s',
    (code) => {
      expect(isCredentialRevocationError(code as string | undefined | null)).toBe(false)
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

  it.each(['account-1', 'slack:T08CM6ZNYBE'])(
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

  it('uses a 1-hour TTL on the dead flag', async () => {
    const redis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis as never)

    await markCredentialDead('acc-1', 'invalid_refresh_token')
    expect(redis.set).toHaveBeenCalledWith('oauth:dead:acc-1', 'invalid_refresh_token', 'EX', 3600)
  })
})
