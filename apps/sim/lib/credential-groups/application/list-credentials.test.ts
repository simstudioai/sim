import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  billingWorkspaceAccessMock,
  billingWorkspaceAccessMockFns,
} from '@sim/testing/mocks/billing-workspace-access.mock'
import {
  credentialGroupsAvailabilityMock,
  credentialGroupsAvailabilityMockFns,
} from '@sim/testing/mocks/credential-groups-availability.mock'
import {
  credentialGroupsCredentialsMock,
  credentialGroupsCredentialsMockFns,
} from '@sim/testing/mocks/credential-groups-credentials.mock'
import {
  resourcePolicyRepositoryMock,
  resourcePolicyRepositoryMockFns,
} from '@sim/testing/mocks/resource-policy-repository.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceContextMock,
  workspaceContextMockFns,
} from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'

vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
vi.mock('@/lib/credential-groups/scoped-availability', () => credentialGroupsAvailabilityMock)
vi.mock('@/lib/resource-policies/repository', () => resourcePolicyRepositoryMock)
vi.mock('@/lib/credential-groups/credentials', () => credentialGroupsCredentialsMock)

vi.mock('@/lib/workspaces/application/workspace-context', () => workspaceContextMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { listCredentialGroupCredentials } from '@/lib/credential-groups/application/list-credentials'
import { CredentialGroupCredentialCursorNotFoundError } from '@/lib/credential-groups/credentials'

const mocks = {
  requirePolicy: resourcePolicyRepositoryMockFns.mockRequireResourcePolicy,
  listCredentials: credentialGroupsCredentialsMockFns.mockListCredentialGroupCredentialReferences,
  loadEnrollmentAccess:
    credentialGroupsCredentialsMockFns.mockLoadCredentialGroupEnrollmentAccessForSubject,
  loadGroup: credentialGroupsCredentialsMockFns.mockLoadScopedAccountsCredentialListContext,
  isAvailable: credentialGroupsAvailabilityMockFns.mockIsScopedCredentialGroupsAvailable,
}
const mockGetWorkspaceOwnerSubscriptionAccess =
  billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess
const loadWorkspace = workspaceContextMockFns.mockLoadActiveWorkspaceApplicationContext
const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

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
  return createExecutorPrincipal({
    workspaceId,
    audience: 'sim:credential-groups',
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: createSessionPrincipal(),
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    },
  })
}

describe('listCredentialGroupCredentials', () => {
  beforeEach(() => {
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy(
        'group-1',
        ['workspace-1'].map((workspaceId) => ({ workspaceId, access: { mode: 'all' as const } }))
      ),
    })
    mocks.loadGroup.mockResolvedValue(groupContext)
    loadWorkspace.mockResolvedValue(workspaceContext)
    resolvePermission.mockResolvedValue('read')
    mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: true })
    mocks.isAvailable.mockResolvedValue(true)
    mocks.loadEnrollmentAccess.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
    mocks.listCredentials.mockResolvedValue({
      credentials: [
        {
          credentialId: 'credential-1',
          email: 'person@example.com',
          accountEmail: 'personal@example.com',
          displayName: 'person@example.com',
          providerId: 'google-email',
          providerSubjectId: 'google-subject-1',
          providerTenantId: null,
        },
      ],
      nextCursor: 'credential-1',
    })
  })

  it('rejects unsupported principals before loading the group', async () => {
    const principal = createSessionPrincipal()

    await expect(
      listCredentialGroupCredentials.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.loadGroup).not.toHaveBeenCalled()
  })

  it('requires the workspace accounts container before listing credentials', async () => {
    mocks.loadGroup.mockResolvedValue(null)
    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.loadGroup).toHaveBeenCalledWith({ kind: 'organization', organizationId: 'org-1' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('rejects executor delegation scoped to another workspace', async () => {
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal('workspace-2'),
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('lists credentials when the original principal has no human subject', async () => {
    const principal = executorPrincipal()
    principal.subjectUserId = undefined
    principal.delegationContext.principal = {
      kind: 'workspace_api_key',
      workspaceId: 'workspace-1',
      keyId: 'workspace-key-1',
    }

    await listCredentialGroupCredentials.execute({ principal, input })

    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).toHaveBeenCalledWith(
      expect.not.objectContaining({ credentialGroupEnrollmentId: expect.anything() })
    )
  })

  it('rejects inconsistent execution attribution', async () => {
    const principal = executorPrincipal()
    principal.subjectUserId = 'different-user'
    await expect(
      listCredentialGroupCredentials.execute({ principal, input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('rechecks workspace revocation for the next discovery', async () => {
    await listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    mocks.listCredentials.mockClear()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', []),
    })
    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('filters restricted integrations before pagination and rejects explicitly requesting them', async () => {
    mocks.loadGroup.mockResolvedValue({
      ...groupContext,
      options: [
        ...groupContext.options,
        { ...groupContext.options[0], id: 'calendar-option', provider: 'google-calendar' },
      ],
    })
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: 'workspace-1',
          access: { mode: 'selected', credentialTypes: ['oauth:gmail'] },
        },
      ]),
    })
    await listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    expect(mocks.listCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ credentialGroupOptionIds: ['option-1'], limit: 50 })
    )
    mocks.listCredentials.mockClear()
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, credentialProviderIds: ['google-calendar'] },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('filters by canonical providers active in the group', async () => {
    await listCredentialGroupCredentials.execute({
      principal: executorPrincipal(),
      input: { ...input, credentialProviderIds: ['google-email', 'google-email'] },
    })

    expect(mocks.listCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ credentialProviderIds: ['google-email'] })
    )
  })

  it('rechecks a provider grant before the next page can expose account identities', async () => {
    mocks.loadGroup.mockResolvedValue({
      ...groupContext,
      options: [
        ...groupContext.options,
        { ...groupContext.options[0], id: 'calendar-option', provider: 'google-calendar' },
      ],
    })
    const query = { ...input, credentialProviderIds: ['google-email'] }
    await listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input: query })
    mocks.listCredentials.mockClear()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', [
        {
          workspaceId: 'workspace-1',
          access: { mode: 'selected', credentialTypes: ['oauth:google-calendar'] },
        },
      ]),
    })
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...query, cursor: 'credential-1' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('rejects providers that are not active in the group before credential access', async () => {
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, credentialProviderIds: ['slack'] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('fails before listing when the group is disabled', async () => {
    mocks.loadGroup.mockResolvedValue({ ...groupContext, status: 'disabled' })

    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('fails before listing when Credential Groups are unavailable', async () => {
    mocks.isAvailable.mockResolvedValue(false)

    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Organization connected accounts are not available',
    })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('rejects limits outside the bounded page size', async () => {
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, limit: 101 },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mockGetWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('classifies a stale or cross-group cursor as invalid input', async () => {
    mocks.listCredentials.mockRejectedValueOnce(new CredentialGroupCredentialCursorNotFoundError())

    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, cursor: 'credential-other' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
  })
})
