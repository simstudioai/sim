/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateLastUsed: vi.fn(),
  resolveWorkspaceBillingPayer: vi.fn(),
  getHighestPrioritySubscription: vi.fn(),
  envFlags: { isAuthDisabled: false },
}))

vi.mock('@/lib/core/config/env-flags', () => mocks.envFlags)
vi.mock('@/lib/api-key/crypto', () => ({ hashApiKey: (value: string) => `hash:${value}` }))
vi.mock('@/lib/auth/oauth-provider', () => ({ OAUTH_ACCESS_TOKEN_PREFIX: 'sim_oat_' }))
vi.mock('@sim/security/hash', () => ({ sha256Hex: (value: string) => `oauth-hash:${value}` }))
vi.mock('@/lib/api-key/service', () => ({ updateApiKeyLastUsed: mocks.updateLastUsed }))
vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveWorkspaceBillingPayer: mocks.resolveWorkspaceBillingPayer,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mocks.getHighestPrioritySubscription,
}))

import {
  authenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError,
} from '@/lib/api/server/routes/v2-api-key-auth'
import {
  hasV2Credential,
  readV2CredentialHeaders,
} from '@/lib/api/server/routes/v2-credential-headers'

describe('v2 API key authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.envFlags.isAuthDisabled = false
    resetDbChainMock()
    mocks.updateLastUsed.mockResolvedValue(undefined)
    mocks.getHighestPrioritySubscription.mockResolvedValue(null)
  })

  it('normalizes a personal key without exposing loose optional identity fields', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
        userBanned: false,
      },
    ])

    const result = await authenticateV2ApiKey({ apiKey: 'secret', bearer: null })

    expect(result).toEqual({
      principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
      rateLimitSubscription: null,
      keyType: 'personal',
      keyExpiresAt: null,
    })
    expect(mocks.getHighestPrioritySubscription).toHaveBeenCalledWith('user-1', {
      onError: 'throw',
    })
  })

  /**
   * `GET /api/v2/meta` reports the key's expiry. Carrying it here — from the
   * row `requireValidRow` has already read and checked — is what keeps the
   * application layer out of the `api_key` table.
   */
  it('carries the authenticated row expiry so no surface re-reads the key', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        userBanned: false,
      },
    ])

    const result = await authenticateV2ApiKey({ apiKey: 'secret', bearer: null })

    expect(result.keyExpiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'))
  })

  it('normalizes a workspace key as the workspace, not its creator', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'creator-1',
        workspaceId: 'workspace-1',
        type: 'workspace',
        expiresAt: null,
        userBanned: false,
      },
    ])
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      organizationId: 'organization-1',
      payerSubscription: {
        plan: 'team',
        referenceId: 'organization-1',
      },
    })

    const result = await authenticateV2ApiKey({ apiKey: 'secret', bearer: null })

    expect(result).toEqual({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
      rateLimitSubjectIds: ['api-key:key-1', 'workspace:workspace-1'],
      rateLimitSubscription: { plan: 'team', referenceId: 'organization-1' },
      keyType: 'workspace',
      keyExpiresAt: null,
    })
    expect(mocks.getHighestPrioritySubscription).not.toHaveBeenCalled()
  })

  it('does not couple a workspace key to its creator ban state', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'creator-1',
        workspaceId: 'workspace-1',
        type: 'workspace',
        expiresAt: null,
        userBanned: true,
      },
    ])
    mocks.resolveWorkspaceBillingPayer.mockResolvedValue({
      billedAccountUserId: 'billing-owner-1',
      organizationId: null,
      payerSubscription: null,
    })

    await expect(authenticateV2ApiKey({ apiKey: 'secret', bearer: null })).resolves.toMatchObject({
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
    })
  })

  it('treats missing, banned, and expired credentials as unauthenticated', async () => {
    await expect(authenticateV2ApiKey({ apiKey: 'missing', bearer: null })).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )

    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
        userBanned: true,
      },
    ])
    await expect(authenticateV2ApiKey({ apiKey: 'banned', bearer: null })).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )

    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-2',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: new Date(Date.now() - 1),
        userBanned: false,
      },
    ])
    await expect(authenticateV2ApiKey({ apiKey: 'expired', bearer: null })).rejects.toBeInstanceOf(
      V2ApiKeyUnauthenticatedError
    )
  })

  it('propagates auth-store failures instead of converting them to invalid credentials', async () => {
    const failure = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(failure)

    await expect(authenticateV2ApiKey({ apiKey: 'secret', bearer: null })).rejects.toBe(failure)
  })
})

describe('v2 bearer token authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.envFlags.isAuthDisabled = false
    resetDbChainMock()
    mocks.getHighestPrioritySubscription.mockResolvedValue({
      plan: 'pro',
      referenceId: 'user-1',
    })
  })

  function tokenRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'token-1',
      userId: 'user-1',
      clientId: 'sim-cli',
      scopes: ['openid', 'api:read', 'api:write'],
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      clientDisabled: false,
      userBanned: false,
      userExists: 'user-1',
      ...overrides,
    }
  }

  it('reads the credential headers as a pair, ignoring other Authorization schemes', () => {
    expect(
      readV2CredentialHeaders(new Headers({ 'x-api-key': 'k', authorization: 'Bearer t' }))
    ).toEqual({ apiKey: 'k', bearer: 't', malformedOAuthBearer: false })
    expect(readV2CredentialHeaders(new Headers({ authorization: 'Basic abc' }))).toEqual({
      apiKey: null,
      bearer: null,
      malformedOAuthBearer: false,
    })
    expect(hasV2Credential(new Headers({ authorization: 'Bearer sim_oat_t' }))).toBe(true)
    expect(hasV2Credential(new Headers())).toBe(false)
  })

  /**
   * A public deployed workflow is routinely called by a gateway that forwards
   * its own `Authorization` header. Counting that as a Sim credential would
   * send an execution that used to run anonymously into a 401.
   */
  it("does not treat somebody else's bearer token as a Sim credential", () => {
    expect(hasV2Credential(new Headers({ authorization: 'Bearer ghp_something' }))).toBe(false)
    expect(hasV2Credential(new Headers({ authorization: 'Bearer sim_oat_t' }))).toBe(true)
    expect(hasV2Credential(new Headers({ authorization: 'Bearer sim_oat_t extra' }))).toBe(true)
  })

  it('rejects a malformed Sim bearer instead of treating optional auth as anonymous', async () => {
    const refused = await authenticateV2ApiKey({
      apiKey: null,
      bearer: null,
      malformedOAuthBearer: true,
    }).catch((error) => error)

    expect(refused).toBeInstanceOf(V2ApiKeyUnauthenticatedError)
    expect(refused.challenge).toBe('bearer')
  })

  it('authenticates an OAuth token as its user, rate-limited on the user plan', async () => {
    queueTableRows(schemaMock.oauthAccessToken, [tokenRow()])

    const result = await authenticateV2ApiKey({ apiKey: null, bearer: 'sim_oat_secret' })

    expect(result).toEqual({
      principal: {
        kind: 'oauth_access_token',
        userId: 'user-1',
        clientId: 'sim-cli',
        tokenId: 'token-1',
        scopes: ['openid', 'api:read', 'api:write'],
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      rateLimitSubjectIds: ['oauth-token:token-1', 'user:user-1'],
      rateLimitSubscription: { plan: 'pro', referenceId: 'user-1' },
      keyType: 'oauth_access_token',
      keyExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    expect(mocks.updateLastUsed).not.toHaveBeenCalled()
  })

  it('prefers the API key when an OAuth token is also present', async () => {
    queueTableRows(schemaMock.apiKey, [
      {
        id: 'key-1',
        userId: 'user-1',
        workspaceId: null,
        type: 'personal',
        expiresAt: null,
        userBanned: false,
      },
    ])

    const result = await authenticateV2ApiKey({ apiKey: 'secret', bearer: 'sim_oat_ignored' })

    expect(result.keyType).toBe('personal')
  })

  it('preserves auth-disabled deployment behavior without verifying an OAuth token', async () => {
    mocks.envFlags.isAuthDisabled = true

    await expect(
      authenticateV2ApiKey({ apiKey: null, bearer: 'sim_oat_unused' })
    ).resolves.toMatchObject({
      principal: { kind: 'personal_api_key', keyId: 'auth-disabled' },
      keyType: 'personal',
    })
    expect(dbChainMockFns.limit).not.toHaveBeenCalled()
  })

  it('answers a refused bearer with the bearer challenge, and a missing one with the key challenge', async () => {
    const refused = await authenticateV2ApiKey({ apiKey: null, bearer: 'sim_oat_unknown' }).catch(
      (error) => error
    )
    expect(refused).toBeInstanceOf(V2ApiKeyUnauthenticatedError)
    expect(refused.challenge).toBe('bearer')

    const missing = await authenticateV2ApiKey({ apiKey: null, bearer: null }).catch(
      (error) => error
    )
    expect(missing).toBeInstanceOf(V2ApiKeyUnauthenticatedError)
    expect(missing.challenge).toBe('api_key')
    expect(missing.message).toBe('API key or OAuth access token required')
  })

  it('refuses a token whose client was disabled', async () => {
    queueTableRows(schemaMock.oauthAccessToken, [tokenRow({ clientDisabled: true })])

    await expect(
      authenticateV2ApiKey({ apiKey: null, bearer: 'sim_oat_secret' })
    ).rejects.toBeInstanceOf(V2ApiKeyUnauthenticatedError)
  })
})
