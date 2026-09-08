/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/oauth-provider', () => ({ OAUTH_ACCESS_TOKEN_PREFIX: 'sim_oat_' }))
vi.mock('@sim/security/hash', () => ({ sha256Hex: (value: string) => `hash:${value}` }))

import {
  InvalidOAuthAccessTokenError,
  parseBearerToken,
  verifyOAuthAccessToken,
} from '@/lib/auth/oauth-access-token'

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-1',
    userId: 'user-1',
    clientId: 'sim-cli',
    scopes: ['offline_access', 'api:read'],
    expiresAt: new Date(Date.now() + 60_000),
    clientDisabled: false,
    userBanned: false,
    userBanExpires: null,
    userSuspendedAt: null,
    userExists: 'user-1',
    ...overrides,
  }
}

async function reason(token: string): Promise<string> {
  const failure = await verifyOAuthAccessToken(token).catch((error) => error)
  expect(failure).toBeInstanceOf(InvalidOAuthAccessTokenError)
  return failure.reason
}

describe('parseBearerToken', () => {
  it('reads exactly one bearer credential and nothing else', () => {
    expect(parseBearerToken(new Headers({ authorization: 'Bearer sim_oat_abc' }))).toBe(
      'sim_oat_abc'
    )
    expect(parseBearerToken(new Headers({ authorization: 'Bearer  sim_oat_abc ' }))).toBe(
      'sim_oat_abc'
    )
    expect(parseBearerToken(new Headers())).toBeNull()
    expect(parseBearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull()
    expect(parseBearerToken(new Headers({ authorization: 'Bearer ' }))).toBeNull()
    expect(parseBearerToken(new Headers({ authorization: 'Bearer a b' }))).toBeNull()
  })

  /**
   * RFC 7235 §2.1 defines the scheme as case-insensitive, so `bearer` is a
   * real credential. Reading it as no credential would let it past the
   * optional-auth path as an anonymous request instead of being refused.
   */
  it('matches the scheme case-insensitively', () => {
    expect(parseBearerToken(new Headers({ authorization: 'bearer sim_oat_abc' }))).toBe(
      'sim_oat_abc'
    )
    expect(parseBearerToken(new Headers({ authorization: 'BEARER sim_oat_abc' }))).toBe(
      'sim_oat_abc'
    )
  })
})

describe('verifyOAuthAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('looks the token up by its hash and returns the principal it stands for', async () => {
    queueTableRows(schemaMock.oauthAccessToken, [row()])

    const principal = await verifyOAuthAccessToken('sim_oat_secret')

    expect(principal).toEqual({
      kind: 'oauth_access_token',
      userId: 'user-1',
      clientId: 'sim-cli',
      tokenId: 'token-1',
      scopes: ['offline_access', 'api:read'],
      expiresAt: expect.any(Date),
    })
    expect(dbChainMockFns.where).toHaveBeenCalledOnce()
    expect(JSON.stringify(dbChainMockFns.where.mock.calls[0])).toContain('hash:secret')
  })

  it('refuses a credential that is not one of ours without a database read', async () => {
    expect(await reason('sim_abc')).toBe('malformed')
    expect(await reason('sim_oat_')).toBe('malformed')
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('refuses an unknown, expired, disabled-client, orphaned, or banned token', async () => {
    expect(await reason('sim_oat_unknown')).toBe('unknown')

    queueTableRows(schemaMock.oauthAccessToken, [row({ expiresAt: new Date(Date.now() - 1) })])
    expect(await reason('sim_oat_x')).toBe('expired')

    queueTableRows(schemaMock.oauthAccessToken, [row({ clientDisabled: true })])
    expect(await reason('sim_oat_x')).toBe('client_disabled')

    queueTableRows(schemaMock.oauthAccessToken, [row({ userId: null, userExists: null })])
    expect(await reason('sim_oat_x')).toBe('user_missing')

    queueTableRows(schemaMock.oauthAccessToken, [row({ userBanned: true })])
    expect(await reason('sim_oat_x')).toBe('user_banned')

    queueTableRows(schemaMock.oauthAccessToken, [row({ userSuspendedAt: new Date() })])
    expect(await reason('sim_oat_x')).toBe('user_banned')

    queueTableRows(schemaMock.oauthAccessToken, [
      row({ userBanned: true, userBanExpires: new Date(Date.now() - 1) }),
    ])
    await expect(verifyOAuthAccessToken('sim_oat_x')).resolves.toMatchObject({ userId: 'user-1' })
  })

  it('propagates a store failure rather than reporting an invalid token', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)

    await expect(verifyOAuthAccessToken('sim_oat_x')).rejects.toBe(failure)
  })
})
