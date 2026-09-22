/** @vitest-environment node */

import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  binding: vi.fn(),
  inventory: vi.fn(),
  token: vi.fn(),
  approval: vi.fn(),
  projection: vi.fn(),
  audit: vi.fn(),
  liveAccounts: vi.fn(),
}))
vi.mock('@/lib/sim-search/live/accounts', () => ({ listLiveAccounts: mocks.liveAccounts }))
vi.mock('@/lib/core/application', () => ({ recordProjectedUseCaseAuditEntries: mocks.audit }))
vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: mocks.authorize,
}))
vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/credential-groups/credentials', async (importOriginal) => ({
  isManagedCredentialGroupBindingLive: (
    await importOriginal<typeof import('@/lib/credential-groups/credentials')>()
  ).isManagedCredentialGroupBindingLive,
  loadManagedCredentialGroupBinding: mocks.binding,
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: mocks.token }))
vi.mock('@/lib/knowledge/application/personal-search-integrations', () => ({
  listPersonalSearchIntegrations: { execute: mocks.inventory },
}))
vi.mock('@/lib/knowledge/search/integration-policy', () => ({
  requireOrganizationSearchApproval: mocks.approval,
}))
vi.mock('@/lib/integrations/tool-projection', () => ({
  projectIntegrationToolsForViewer: mocks.projection,
}))
vi.mock('@/lib/sim-search/connectors', () => ({
  SEARCH_CONNECTORS: [
    { type: 'drive', providerId: 'google-drive', meta: { name: 'Google Drive' } },
  ],
}))
vi.mock('@/lib/oauth/utils', () => ({ providerIdsForService: (provider: string) => [provider] }))

import {
  prepareOrganizationPersonalConnection,
  resolveOrganizationPersonalToken,
} from '@/lib/credentials/application/resolve-organization-personal-token'

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
    mocks.liveAccounts.mockResolvedValue([])
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
  it.each(['admin_source', 'service_account', 'personal_token', 'managed_mcp'])(
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
    expect(mocks.inventory).toHaveBeenCalledWith({
      principal,
      input: { organizationId: 'org', connectorType: 'drive' },
    })
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        credentialId: 'own',
        requiredScopes: ['read'],
      })
    )
    expect(mocks.token.mock.calls[0][0].workspaceId).toBeUndefined()
    expect(mocks.audit).toHaveBeenCalledOnce()
  })

  it.each([
    { ...liveBinding, organizationId: 'other' },
    { ...liveBinding, workspaceId: 'workspace' },
    { ...liveBinding, providerId: 'slack' },
    { ...liveBinding, managedOauthStatus: 'revoked' },
    { ...liveBinding, enrollmentStatus: 'revoked' },
    { ...liveBinding, groupStatus: 'disabled' },
    { ...liveBinding, optionStatus: 'disabled' },
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

  it.each(['authorize', 'approval', 'inventory'] as const)(
    'propagates current %s refusal before token use',
    async (guard) => {
      mocks[guard].mockRejectedValue(new Error('revoked'))
      await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
        'revoked'
      )
      expect(mocks.token).not.toHaveBeenCalled()
    }
  )

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
    expect(mocks.token).toHaveBeenCalledWith(expect.objectContaining({ requiredScopes: ['read'] }))
    mocks.token.mockRejectedValue(new Error('insufficient scopes'))
    await expect(resolveOrganizationPersonalToken.execute({ principal, input })).rejects.toThrow(
      'insufficient scopes'
    )
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
