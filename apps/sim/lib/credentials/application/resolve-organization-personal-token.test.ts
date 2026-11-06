import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { credential } from '@sim/db/schema'
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
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { resetEnvFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import {
  knowledgeSearchIntegrationPolicyMock,
  knowledgeSearchIntegrationPolicyMockFns,
} from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
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
  policies: vi.fn(),
}))
vi.mock('@/lib/sim-search/live/policy-store', async (original) => ({
  ...(await original<typeof import('@/lib/sim-search/live/policy-store')>()),
  loadLiveSearchPolicies: hoisted.policies,
}))
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

function queueOwnedCredential() {
  queueTableRows(credential, [
    {
      id: 'own',
      providerId: 'google-drive',
      displayName: 'Own account',
      grantedScopes: ['read'],
      managedOauthStatus: 'active',
      optionId: 'option',
      enrollmentStatus: 'completed',
      groupStatus: 'active',
      options: [{ id: 'option', status: 'active' }],
    },
  ])
}

describe('organization personal token authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetDbChainMock()
    resetEnvFlagsMock()
    blockVisibilityMockFns.mockGetBlockVisibility.mockResolvedValue(null)
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
    queueOwnedCredential()
    await expect(
      resolveOrganizationPersonalToken.execute({ principal, input })
    ).resolves.toHaveProperty('accessToken', 'secret')
    expect(mocks.inventory).not.toHaveBeenCalled()
  })
  it('does not let direct integration tools bypass current organization scope restrictions', async () => {
    queueOwnedCredential()
    mocks.policies.mockResolvedValue({
      google_drive: {
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
  it('observes a revoked live account without falling back to old indexing membership', async () => {
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'own connected account'
    )
    expect(mocks.token).not.toHaveBeenCalled()
  })
  it('uses the authenticated person inventory and organization token scope without a workspace', async () => {
    queueOwnedCredential()
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

  it('returns the live account target for a connection request without an indexed source', async () => {
    const target = {
      type: 'link',
      provider: 'google-drive',
      connectorType: 'google_drive',
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
  })
})
