/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'

const mocks = vi.hoisted(() => ({
  getWorkspaceOwnerSubscriptionAccess: vi.fn(),
  requirePolicy: vi.fn(),
  listCredentials: vi.fn(),
  loadKey: vi.fn(),
  decrypt: vi.fn(),
  loadEnrollmentAccess: vi.fn(),
  loadGroup: vi.fn(),
  loadWorkspace: vi.fn(),
  resolveCredentialGroupsAvailability: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/billing/core/workspace-access', () => ({
  getWorkspaceOwnerSubscriptionAccess: mocks.getWorkspaceOwnerSubscriptionAccess,
}))

vi.mock('@/lib/credential-groups/scoped-availability', () => ({
  isScopedCredentialGroupsAvailable: async () =>
    (await mocks.resolveCredentialGroupsAvailability()).available,
}))
vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.requirePolicy,
}))

vi.mock('@/lib/credential-groups/credentials', () => ({
  CredentialGroupCredentialCursorNotFoundError: class extends Error {
    constructor() {
      super('Credential group credential cursor not found')
      this.name = 'CredentialGroupCredentialCursorNotFoundError'
    }
  },
  listCredentialGroupCredentialReferences: mocks.listCredentials,
  loadCredentialGroupEnrollmentAccessForSubject: mocks.loadEnrollmentAccess,
  loadScopedAccountsCredentialListContext: mocks.loadGroup,
  MAX_CREDENTIAL_GROUP_CREDENTIAL_PAGE_SIZE: 100,
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import {
  getCredentialGroupApiKey,
  listCredentialGroupApiKeys,
} from '@/lib/credential-groups/application/api-keys'

vi.mock('@/lib/credential-groups/api-keys', () => ({
  listCredentialGroupApiKeyReferences: mocks.listCredentials,
  loadCredentialGroupApiKey: mocks.loadKey,
}))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))

const groupContext = {
  credentialGroupId: 'group-1',
  workspaceId: 'workspace-1',
  name: 'Credential Group',
  status: 'active' as const,
  options: [
    {
      id: 'option-1',
      provider: 'gmail' as const,
      label: 'Work Gmail',
      authorizationAppId: 'google:client-1',
      requiredScopes: ['gmail.readonly'],
      scopeVersion: 1,
      required: true,
      status: 'active' as const,
    },
    {
      id: 'option-disabled',
      provider: 'gmail' as const,
      label: 'Old Gmail',
      authorizationAppId: 'google:client-1',
      requiredScopes: ['gmail.readonly'],
      scopeVersion: 1,
      required: false,
      status: 'disabled' as const,
    },
  ],
}
const workspaceContext = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}
const input = { workspaceId: 'workspace-1', limit: 50 }

function executorPrincipal(workspaceId = 'workspace-1'): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    },
  }
}

const metadata = {
  credentialId: 'key-1',
  optionId: 'option-1',
  name: 'Exa API key',
  email: 'other@example.com',
}
describe('credential group API key authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        { workspaceId: 'workspace-1', access: { mode: 'selected', credentialTypes: ['api_key'] } },
      ]),
    })
    mocks.loadGroup.mockResolvedValue(groupContext)
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: true })
    mocks.resolveCredentialGroupsAvailability.mockResolvedValue({ available: true })
    mocks.listCredentials.mockResolvedValue({
      apiKeys: [metadata],
      count: 1,
      hasMore: false,
      nextCursor: null,
    })
    mocks.loadKey.mockResolvedValue({ ...metadata, encryptedValue: 'ciphertext' })
    mocks.decrypt.mockResolvedValue({ decrypted: 'test-api-key-secret' })
  })

  it('lists metadata with explicit filters, independently of the executing user', async () => {
    const result = await listCredentialGroupApiKeys.execute({
      principal: executorPrincipal(),
      input: { ...input, keyName: ' Exa API key ', email: 'OTHER@example.com' },
    })
    expect(result.apiKeys).toEqual([metadata])
    expect(mocks.listCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', credentialGroupId: 'group-1' }),
      { keyName: 'Exa API key', email: 'other@example.com', limit: 50, cursor: undefined }
    )
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it('requires an explicit credential ID and decrypts only after current authorization', async () => {
    const result = await getCredentialGroupApiKey.execute({
      principal: executorPrincipal(),
      input: { workspaceId: input.workspaceId, credentialId: metadata.credentialId },
    })
    expect(result).toEqual({
      ...metadata,
      apiKey: 'test-api-key-secret',
      encryptedValue: 'ciphertext',
    })
    expect(mocks.loadKey).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      'key-1'
    )
    expect(mocks.requirePolicy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadKey.mock.invocationCallOrder[0]
    )
    expect(mocks.loadKey.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.decrypt.mock.invocationCallOrder[0]
    )
  })

  it('rejects a session before loading protected data', async () => {
    const principal: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 's' }
    await expect(listCredentialGroupApiKeys.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.loadGroup).not.toHaveBeenCalled()
  })

  it('rejects a delegation for another workspace', async () => {
    await expect(
      listCredentialGroupApiKeys.execute({ principal: executorPrincipal('other-workspace'), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it.each(['none', 'oauth_only', 'disabled', 'no_permission'])(
    'does not resolve or decrypt when access is %s',
    async (state) => {
      if (state === 'none')
        mocks.requirePolicy.mockResolvedValue({
          document: buildOrganizationAccountAccessPolicy('group-1', []),
        })
      if (state === 'oauth_only')
        mocks.requirePolicy.mockResolvedValue({
          document: buildOrganizationAccountAccessPolicy('group-1', [
            {
              workspaceId: 'workspace-1',
              access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
            },
          ]),
        })
      if (state === 'disabled')
        mocks.loadGroup.mockResolvedValue({ ...groupContext, status: 'disabled' })
      if (state === 'no_permission') mocks.resolvePermission.mockResolvedValue(null)
      await expect(
        getCredentialGroupApiKey.execute({
          principal: executorPrincipal(),
          input: { workspaceId: input.workspaceId, credentialId: 'key-1' },
        })
      ).rejects.toThrow()
      expect(mocks.loadKey).not.toHaveBeenCalled()
      expect(mocks.decrypt).not.toHaveBeenCalled()
    }
  )

  it('rejects missing keys before decrypting', async () => {
    mocks.loadKey.mockRejectedValue(new Error('API key credential is unavailable'))
    await expect(
      getCredentialGroupApiKey.execute({
        principal: executorPrincipal(),
        input: { workspaceId: input.workspaceId, credentialId: 'another-group-key' },
      })
    ).rejects.toThrow('unavailable')
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it.each([{ limit: 0 }, { limit: 101 }, { keyName: ' ' }, { email: 'invalid' }, { cursor: ' ' }])(
    'rejects invalid filters %j before querying keys',
    async (invalid) => {
      await expect(
        listCredentialGroupApiKeys.execute({
          principal: executorPrincipal(),
          input: { ...input, ...invalid },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.listCredentials).not.toHaveBeenCalled()
    }
  )

  it('fails closed if stored key cannot be redacted', async () => {
    mocks.decrypt.mockResolvedValue({ decrypted: 'short' })
    await expect(
      getCredentialGroupApiKey.execute({
        principal: executorPrincipal(),
        input: { workspaceId: input.workspaceId, credentialId: 'key-1' },
      })
    ).rejects.toThrow('secret provenance')
  })
})
