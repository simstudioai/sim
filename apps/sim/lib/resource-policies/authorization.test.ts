/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnterprise: vi.fn(),
  loadPolicy: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/resource-policies/repository', () => ({
  loadResourcePolicy: mocks.loadPolicy,
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: mocks.isEnterprise,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  resolveWorkspaceGroup: mocks.resolveGroup,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { findResourcePolicyGrant } from '@/lib/resource-policies/authorization'

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
}

function principal(input?: { mode?: 'draft' | 'deployment' }): WorkflowExecutionDelegatedPrincipal {
  const mode = input?.mode ?? 'deployment'
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      currentWorkflow:
        mode === 'deployment'
          ? {
              workflowId: 'workflow-1',
              mode,
              deploymentVersionId: 'deployment-version-1',
            }
          : { workflowId: 'workflow-1', mode },
    },
  }
}

function policy(subject: Record<string, unknown>) {
  return {
    id: 'policy-1',
    workspaceId: 'workspace-1',
    revision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    document: {
      version: 1,
      resource: { type: 'credential_group', id: 'group-1' },
      grants: [
        {
          id: 'grant-1',
          subject,
          actions: ['credential_groups.credentials.use'],
        },
      ],
    },
  }
}

describe('findResourcePolicyGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnterprise.mockResolvedValue(true)
    mocks.resolvePermission.mockResolvedValue('read')
  })

  it('matches workflow grants only for deployed current workflow authority', async () => {
    mocks.loadPolicy.mockResolvedValue(policy({ type: 'workflow', workflowId: 'workflow-1' }))
    const input = {
      context,
      resourceType: 'credential_group' as const,
      resourceId: 'group-1',
      action: 'credential_groups.credentials.use' as const,
    }

    await expect(
      findResourcePolicyGrant({ ...input, principal: principal() })
    ).resolves.toMatchObject({
      id: 'grant-1',
    })
    await expect(
      findResourcePolicyGrant({ ...input, principal: principal({ mode: 'draft' }) })
    ).resolves.toBeNull()
  })

  it('matches an exact verified external identity', async () => {
    mocks.loadPolicy.mockResolvedValue(
      policy({
        type: 'external_identity',
        provider: 'slack',
        tenantId: 'T123',
        subjectId: 'U123',
      })
    )
    const external = principal()
    external.subjectUserId = undefined
    if (!external.delegationContext) throw new Error('Test principal is missing delegation context')
    external.delegationContext.principal = {
      kind: 'system',
      serviceId: 'webhook',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'slack',
      subject: {
        kind: 'external_user',
        provider: 'slack',
        tenantId: 'T123',
        subjectId: 'U123',
      },
    }

    await expect(
      findResourcePolicyGrant({
        principal: external,
        context,
        resourceType: 'credential_group',
        resourceId: 'group-1',
        action: 'credential_groups.credentials.use',
      })
    ).resolves.toMatchObject({ id: 'grant-1' })
  })

  it('treats absence of a policy as no additional grant', async () => {
    mocks.loadPolicy.mockResolvedValue(null)

    await expect(
      findResourcePolicyGrant({
        principal: principal(),
        context,
        resourceType: 'credential_group',
        resourceId: 'group-1',
        action: 'credential_groups.credentials.use',
      })
    ).resolves.toBeNull()
  })

  it('matches live workspace roles and effective Access Control Groups', async () => {
    mocks.loadPolicy.mockResolvedValue(policy({ type: 'workspace_role', minimumRole: 'write' }))
    mocks.resolvePermission.mockResolvedValue('admin')
    const input = {
      principal: principal(),
      context,
      resourceType: 'credential_group' as const,
      resourceId: 'group-1',
      action: 'credential_groups.credentials.use' as const,
    }

    await expect(findResourcePolicyGrant(input)).resolves.toMatchObject({ id: 'grant-1' })

    mocks.loadPolicy.mockResolvedValue(
      policy({ type: 'access_control_group', accessControlGroupId: 'access-group-1' })
    )
    mocks.resolveGroup.mockResolvedValue({ permissionGroupId: 'access-group-1' })

    await expect(findResourcePolicyGrant(input)).resolves.toMatchObject({ id: 'grant-1' })
    expect(mocks.resolveGroup).toHaveBeenCalledWith('user-1', 'organization-1', 'workspace-1')
  })

  it('matches direct human operations without inventing workflow authority', async () => {
    mocks.loadPolicy.mockResolvedValue(policy({ type: 'user', userId: 'user-1' }))

    await expect(
      findResourcePolicyGrant({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        context,
        resourceType: 'credential_group',
        resourceId: 'group-1',
        action: 'credential_groups.credentials.use',
      })
    ).resolves.toMatchObject({ id: 'grant-1' })
  })

  it('fails fast when executor delegation has lost its original principal', async () => {
    mocks.loadPolicy.mockResolvedValue(policy({ type: 'user', userId: 'user-1' }))
    const unbound = principal()
    if (!unbound.delegationContext) throw new Error('Test principal is missing delegation context')
    unbound.delegationContext.principal = undefined

    await expect(
      findResourcePolicyGrant({
        principal: unbound,
        context,
        resourceType: 'credential_group',
        resourceId: 'group-1',
        action: 'credential_groups.credentials.use',
      })
    ).rejects.toThrow('bound workflow execution principal')
  })

  it('fails fast when policy storage disagrees with the canonical workspace', async () => {
    mocks.loadPolicy.mockResolvedValue({
      ...policy({ type: 'user', userId: 'user-1' }),
      workspaceId: 'workspace-2',
    })

    await expect(
      findResourcePolicyGrant({
        principal: principal(),
        context,
        resourceType: 'credential_group',
        resourceId: 'group-1',
        action: 'credential_groups.credentials.use',
      })
    ).rejects.toThrow('workspace does not match')
  })
})
