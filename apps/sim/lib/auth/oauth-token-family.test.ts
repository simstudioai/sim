/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationUserMutationLocks: vi.fn(async () => undefined),
  getUserOrganization: vi.fn(async () => null),
}))
vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://sim.example' }))
vi.mock('@/lib/permission-groups/locks', () => ({
  acquirePermissionGroupOrgLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  isOrganizationPermissionRegimeActive: vi.fn(async () => false),
}))
vi.mock('@/lib/permission-groups/capability-assertions', () => ({
  isEntitledOrganizationCapabilityWithheld: vi.fn(async () => false),
}))

import { rotateOAuthRefreshToken } from '@/lib/auth/oauth-token-family'

const resource = 'https://sim.example/api/mcp/search/organizations/one'
const credentials = { clientId: 'search-client', method: 'none' as const }
const scopes = ['search:read', 'offline_access']

function queueGrant(target: string | null, grantedScopes = scopes) {
  const client = {
    ...credentials,
    clientSecret: null,
    disabled: false,
    public: true,
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    scopes: grantedScopes,
    skipConsent: false,
  }
  const token = {
    id: 'refresh-1',
    clientId: credentials.clientId,
    sessionId: null,
    userId: 'user-1',
    referenceId: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    revoked: null,
    authTime: new Date(),
    scopes: grantedScopes,
    resource: target,
    familyId: 'family-1',
    familyConsentId: 'consent-1',
    generation: 0,
  }
  queueTableRows(schemaMock.oauthClient, [client])
  queueTableRows(schemaMock.oauthClient, [client])
  queueTableRows(schemaMock.oauthRefreshToken, [token])
  queueTableRows(schemaMock.oauthRefreshToken, [token])
  queueTableRows(schemaMock.user, [{ id: 'user-1', banned: false }])
  queueTableRows(schemaMock.oauthConsent, [{ id: 'consent-1', scopes: grantedScopes }])
  queueTableRows(schemaMock.oauthTokenFamily, [
    {
      id: token.familyId,
      clientId: token.clientId,
      userId: token.userId,
      sessionId: token.sessionId,
      referenceId: token.referenceId,
      currentGeneration: 0,
      expiresAt: token.expiresAt,
    },
  ])
  dbChainMockFns.returning.mockResolvedValueOnce([{ id: token.id }])
}

describe('OAuth refresh audience binding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each([resource, undefined])(
    'retains the original audience when refreshed with %s',
    async (requested) => {
      queueGrant(resource)
      const result = await rotateOAuthRefreshToken({
        credentials,
        refreshToken: 'sim_ort_original',
        resource: requested,
      })
      expect(result.success).toBe(true)
      expect(dbChainMockFns.values).toHaveBeenCalledTimes(2)
      for (const [values] of dbChainMockFns.values.mock.calls) {
        expect(values).toMatchObject({ resource })
      }
    }
  )

  it('cannot change the audience or convert an old API grant into a Search grant', async () => {
    queueGrant(resource)
    const substituted = await rotateOAuthRefreshToken({
      credentials,
      refreshToken: 'sim_ort_original',
      resource: `${resource}-other`,
    })
    expect(substituted).toMatchObject({ success: false, error: 'invalid_target' })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()

    resetDbChainMock()
    queueGrant(null, ['api:read', 'offline_access'])
    const expanded = await rotateOAuthRefreshToken({
      credentials,
      refreshToken: 'sim_ort_original',
      resource,
    })
    expect(expanded).toMatchObject({ success: false, error: 'invalid_target' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('keeps audience restriction even when an access token narrows away its Search scope', async () => {
    queueGrant(resource)
    const result = await rotateOAuthRefreshToken({
      credentials,
      refreshToken: 'sim_ort_original',
      requestedScopes: ['offline_access'],
    })
    expect(result).toMatchObject({ success: true, value: { scope: 'offline_access' } })
    expect(dbChainMockFns.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource, scopes: ['offline_access'] })
    )
  })

  it.each([undefined, 'https://sim.example/api/mcp/search/workspace-one'])(
    'does not renew a removed workspace resource when resource is %s',
    async (requestedResource) => {
      queueGrant('https://sim.example/api/mcp/search/workspace-one')
      const result = await rotateOAuthRefreshToken({
        credentials,
        refreshToken: 'sim_ort_original',
        ...(requestedResource ? { resource: requestedResource } : {}),
      })
      expect(result).toMatchObject({ success: false, error: 'invalid_target' })
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      expect(dbChainMockFns.values).not.toHaveBeenCalled()
    }
  )

  it('preserves unscoped API grants and refuses scope escalation', async () => {
    queueGrant(null, ['api:read', 'offline_access'])
    const oldGrant = await rotateOAuthRefreshToken({
      credentials,
      refreshToken: 'sim_ort_original',
    })
    expect(oldGrant.success).toBe(true)
    expect(dbChainMockFns.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: null })
    )

    resetDbChainMock()
    queueGrant(resource)
    const escalated = await rotateOAuthRefreshToken({
      credentials,
      refreshToken: 'sim_ort_original',
      requestedScopes: ['api:write'],
    })
    expect(escalated).toMatchObject({ success: false, error: 'invalid_scope' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
