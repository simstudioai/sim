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

import { listCredentialGroupCredentials } from '@/lib/credential-groups/application/list-credentials'
import { CredentialGroupCredentialCursorNotFoundError } from '@/lib/credential-groups/credentials'

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

describe('listCredentialGroupCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', ['workspace-1']),
    })
    mocks.loadGroup.mockResolvedValue(groupContext)
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.getWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: true })
    mocks.resolveCredentialGroupsAvailability.mockResolvedValue({ available: true })
    mocks.loadEnrollmentAccess.mockResolvedValue({
      enrollmentId: 'enrollment-1',
      email: 'person@example.com',
    })
    mocks.listCredentials.mockResolvedValue({
      credentials: [
        {
          credentialId: 'credential-1',
          email: 'person@example.com',
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
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'user-1',
      sessionId: 'session-1',
    }

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

  it('lists credentials without requiring the actor to be enrolled', async () => {
    mocks.loadEnrollmentAccess.mockResolvedValueOnce(null)

    await listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })

    expect(mocks.loadEnrollmentAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).toHaveBeenCalled()
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

  it('returns a bounded page after current workspace and entitlement checks', async () => {
    const result = await listCredentialGroupCredentials.execute({
      principal: executorPrincipal(),
      input,
    })

    expect(mocks.resolvePermission).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'org-1',
      undefined,
      {
        forUpdate: undefined,
      }
    )
    expect(mocks.listCredentials).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialGroupId: 'group-1',
      limit: 50,
      cursor: undefined,
      email: undefined,
      credentialProviderIds: undefined,
      credentialGroupOptionIds: ['option-1'],
    })
    expect(result).toEqual({
      credentials: [
        {
          credentialId: 'credential-1',
          email: 'person@example.com',
          displayName: 'person@example.com',
          providerId: 'google-email',
          providerSubjectId: 'google-subject-1',
          providerTenantId: null,
        },
      ],
      count: 1,
      hasMore: true,
      nextCursor: 'credential-1',
    })
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

  it('normalizes an optional email filter independently of caller identity', async () => {
    await listCredentialGroupCredentials.execute({
      principal: executorPrincipal(),
      input: { ...input, email: ' Person@Example.COM ' },
    })

    expect(mocks.listCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'person@example.com' })
    )
  })

  it('rejects an invalid email filter', async () => {
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, email: 'not-an-email' },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Email must be a valid address' })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('rejects providers that are not active in the group before credential access', async () => {
    await expect(
      listCredentialGroupCredentials.execute({
        principal: executorPrincipal(),
        input: { ...input, credentialProviderIds: ['slack'] },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.getWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('fails before listing when the group is disabled', async () => {
    mocks.loadGroup.mockResolvedValue({ ...groupContext, status: 'disabled' })

    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.getWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('fails before listing when Credential Groups are unavailable', async () => {
    mocks.resolveCredentialGroupsAvailability.mockResolvedValue({
      available: false,
      reason: 'feature_disabled',
    })

    await expect(
      listCredentialGroupCredentials.execute({ principal: executorPrincipal(), input })
    ).rejects.toMatchObject({
      code: 'not_found',
      message: 'Organization connected accounts are not available',
    })
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('identifies the Enterprise requirement for unavailable hosted workspaces', async () => {
    mocks.getWorkspaceOwnerSubscriptionAccess.mockResolvedValue({ isEnterprise: false })
    mocks.resolveCredentialGroupsAvailability.mockResolvedValue({
      available: false,
      reason: 'enterprise_plan_required',
    })

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
    expect(mocks.getWorkspaceOwnerSubscriptionAccess).not.toHaveBeenCalled()
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
