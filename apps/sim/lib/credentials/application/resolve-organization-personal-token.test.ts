import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import {
  blockVisibilityMock,
  blockVisibilityMockFns,
} from '@sim/testing/mocks/block-visibility.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  credentialsManagedOauthMock,
  credentialsManagedOauthMockFns,
} from '@sim/testing/mocks/credentials-managed-oauth.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
import { oauthUtilsMock } from '@sim/testing/mocks/oauth-utils.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import { permissionGroupsResolveMock } from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  inventory: vi.fn(),
  projection: vi.fn(),
  audit: vi.fn(),
  liveAccounts: vi.fn(),
  policies: vi.fn(),
}))
vi.mock('@/lib/sim-search/live/policy-store', async (original) => ({
  ...(await original<typeof import('@/lib/sim-search/live/policy-store')>()),
  loadLiveSearchPolicies: hoisted.policies,
}))
vi.mock('@/lib/sim-search/live/accounts', () => ({ listLiveAccounts: hoisted.liveAccounts }))
vi.mock('@/lib/core/application', () => ({ recordProjectedUseCaseAuditEntries: hoisted.audit }))
vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/core/config/block-visibility', () => blockVisibilityMock)
vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)
vi.mock('@/lib/credentials/managed-oauth', () => credentialsManagedOauthMock)
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  listPersonalSearchIntegrations: { execute: hoisted.inventory },
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)
vi.mock('@/lib/integrations/tool-projection', () => ({
  projectIntegrationToolsForViewer: hoisted.projection,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_CONNECTORS: [
    { type: 'drive', providerId: 'google-drive', meta: { name: 'Google Drive' } },
  ],
}))
vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)

import {
  prepareOrganizationPersonalConnection,
  resolveOrganizationPersonalToken,
} from '@/lib/credentials/application/resolve-organization-personal-token'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

const mocks = {
  ...hoisted,
  binding: credentialGroupsCredentialsMockFns.mockLoadManagedCredentialGroupBinding,
  token: credentialsManagedOauthMockFns.mockResolveManagedOAuthToken,
  approval: knowledgeSearchIntegrationPolicyMockFns.mockRequireOrganizationSearchApproval,
  authorize: organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation,
}

const principal: OrganizationDelegatedPrincipal = {
  kind: 'organization_delegated',
  serviceId: 'copilot',
  subjectUserId: 'person',
  organizationId: 'org',
  delegationId: 'call',
  audience: 'sim:knowledge',
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  resourceScope: { chatId: 'chat' },
}
const input = {
  organizationId: 'org',
  credentialId: 'own',
  expectedProviderId: 'google-drive',
  requiredScopes: ['read'],
  toolId: 'drive_list',
}

const liveBinding = {
  organizationId: 'org',
  workspaceId: null,
  providerId: 'google-drive',
  managedOauthStatus: 'active',
  enrollmentStatus: 'completed',
  groupStatus: 'active',
  optionStatus: 'active',
}

describe('organization personal token authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEnvFlagsMock()
    blockVisibilityMockFns.mockGetBlockVisibility.mockResolvedValue(null)
    mocks.liveAccounts.mockResolvedValue([])
    mocks.policies.mockResolvedValue({})
    mocks.authorize.mockResolvedValue({ organizationId: 'org', userId: 'person', role: 'member' })
    mocks.binding.mockResolvedValue(liveBinding)
    mocks.projection.mockReturnValue({ tools: [{ toolId: 'drive_list' }] })
    mocks.inventory.mockResolvedValue({
      connections: [
        { indexingStatus: 'indexed', accounts: [{ credentialId: 'own', status: 'connected' }] },
      ],
      nextCursor: null,
    })
    mocks.token.mockResolvedValue({ accessToken: 'secret', refreshed: false })
  })

  it('uses current personal OAuth inventory in live mode without consulting indexed sources', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    mocks.liveAccounts.mockResolvedValue([
      { id: 'own', providerId: 'google-drive', type: 'managed_oauth' },
    ])
    await expect(
      resolveOrganizationPersonalToken.execute({ principal, input })
    ).resolves.toHaveProperty('accessToken', 'secret')
    expect(mocks.inventory).not.toHaveBeenCalled()
    expect(mocks.liveAccounts).toHaveBeenCalledWith({ organizationId: 'org' }, 'person')
  })
  it('does not let direct integration tools bypass current organization scope restrictions', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    mocks.liveAccounts.mockResolvedValue([
      { id: 'own', providerId: 'google-drive', type: 'managed_oauth' },
    ])
    mocks.policies.mockResolvedValue({
      drive: {
        ...defaultLiveSearchPolicy(),
        accessMode: 'service_account',
        mode: 'selected',
        included: ['folder'],
      },
    })
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'Use search_workspace'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it.each(['service_account'])(
    'never substitutes a %s for a personal OAuth account',
    async (type) => {
      setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
      mocks.liveAccounts.mockResolvedValue([{ id: 'own', providerId: 'google-drive', type }])
      await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
        'own connected account'
      )
      expect(mocks.token).not.toHaveBeenCalled()
      expect(mocks.inventory).not.toHaveBeenCalled()
    }
  )
  it('observes a revoked live account without falling back to old indexing membership', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'own connected account'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('uses the authenticated person inventory and organization token scope without a workspace', async () => {
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).resolves.toEqual({
      accessToken: 'secret',
      refreshed: false,
      credentialType: 'managed_oauth',
    })
    expect(mocks.token.mock.calls[0][0].workspaceId).toBeUndefined()
  })

  it.each([
    { ...liveBinding, organizationId: 'other' },
    { ...liveBinding, providerId: 'slack' },
    { ...liveBinding, enrollmentStatus: 'revoked' },
    null,
  ])('rejects mismatched or inactive grants before minting: %j', async (binding) => {
    mocks.binding.mockResolvedValue(binding)
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects another member account even when the org role is admin', async () => {
    mocks.authorize.mockResolvedValue({ organizationId: 'org', userId: 'person', role: 'admin' })
    mocks.inventory.mockResolvedValue({ connections: [], nextCursor: null })
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'own connected account'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('propagates a current organization search approval refusal before token use', async () => {
    mocks.approval.mockRejectedValue(new Error('revoked'))
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'revoked'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('rechecks the operation denylist', async () => {
    mocks.projection.mockReturnValue({ tools: [] })
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'operation is unavailable'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('does not confuse paused indexing with account authorization', async () => {
    mocks.inventory.mockResolvedValue({
      connections: [
        { indexingStatus: 'paused', accounts: [{ credentialId: 'own', status: 'connected' }] },
      ],
      nextCursor: null,
    })
    await expect(
      resolveOrganizationPersonalToken.execute({ principal, input })
    ).resolves.toHaveProperty('credentialType', 'managed_oauth')
  })

  it('returns the live account target for a connection request without an indexed source', async () => {
    setEnvFlags({ isLiveEnterpriseSearchEnabled: true })
    const target = {
      type: 'link',
      provider: 'google-drive',
      connectorType: 'drive',
      connectionMode: 'live',
      optionId: 'option',
    }
    mocks.inventory.mockResolvedValue({
      connections: [],
      available: [{ target }],
      nextCursor: null,
    })
    const result = await prepareOrganizationPersonalConnection.execute({
      principal,
      input: { organizationId: 'org', providerName: 'Google Drive' },
    })
    expect(result).toEqual({ provider: 'Google Drive', providerId: 'google-drive', target })
    expect(result).not.toHaveProperty('settingsPath')
    expect(mocks.liveAccounts).not.toHaveBeenCalled()
  })

  it('finds an exact reconnect control on a later inventory page', async () => {
    const target = {
      type: 'link',
      provider: 'google-drive',
      connectorType: 'drive',
      connectorId: 'connector',
      credentialId: 'own',
    }
    mocks.inventory.mockResolvedValueOnce({ connections: [], available: [], nextCursor: 'next' })
    mocks.inventory.mockResolvedValueOnce({
      connections: [{ accounts: [{ credentialId: 'own', action: target }] }],
      available: [],
      nextCursor: null,
    })
    await expect(
      prepareOrganizationPersonalConnection.execute({
        principal,
        input: { organizationId: 'org', providerName: 'Google Drive', credentialId: 'own' },
      })
    ).resolves.toEqual({ provider: 'Google Drive', providerId: 'google-drive', target })
    expect(mocks.inventory.mock.calls[1][0].input.cursor).toBe('next')
    expect(mocks.token).not.toHaveBeenCalled()
  })
})
