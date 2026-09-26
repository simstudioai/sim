import {
  createExecutorPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import {
  credentialGroupsEnrollmentsMock,
  credentialGroupsEnrollmentsMockFns,
} from '@sim/testing/mocks/credential-groups-enrollments.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupsAvailable: hoisted.requireAvailable,
  resolveWorkspaceAccountsContext: hoisted.resolveGroup,
}))

vi.mock('@/lib/credential-groups/enrollments', () => credentialGroupsEnrollmentsMock)

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

import { createCredentialGroupInviteLink } from '@/lib/credential-groups/application/create-invite-link'

const mocks = {
  ...hoisted,
  createInvitationLink: credentialGroupsEnrollmentsMockFns.mockCreateCredentialGroupInvitationLink,
}

const resolvePermission = workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission

const context = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
  credentialGroupId: 'group-1',
  name: 'Support',
  status: 'active' as const,
  options: [],
}

function executorPrincipal(workspaceId = 'workspace-1') {
  return createExecutorPrincipal({
    subjectUserId: 'admin-1',
    workspaceId,
    audience: 'sim:credential-groups',
    delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
  })
}

describe('createCredentialGroupInviteLink', () => {
  beforeEach(() => {
    mocks.resolveGroup.mockResolvedValue(context)
    resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.createInvitationLink.mockResolvedValue({
      enrollment: {
        id: 'enrollment-1',
        email: 'person@example.com',
        status: 'invited',
      },
      invitationLink: 'https://sim.ai/credential-groups/enroll/token-1',
    })
  })

  it('rejects unsupported principals before loading the group', async () => {
    const principal = createSessionPrincipal({ userId: 'admin-1' })

    await expect(
      createCredentialGroupInviteLink.execute({
        principal,
        input: { workspaceId: 'workspace-1', email: 'person@example.com' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.resolveGroup).not.toHaveBeenCalled()
  })

  it('issues an unattributed link for an actorless run', async () => {
    // A schedule (or a webhook with no external subject) reaches this with a real
    // admin-scoped delegation and no person on it. The delegation is the authority;
    // the issuer is only recorded, and `created_by` is nullable — so this issues the
    // link with no issuer rather than refusing, which is what it did when the
    // subject was demanded here.
    const { subjectUserId: _subject, ...base } = executorPrincipal()
    // What actually authorizes an actorless caller: the delegation is running a
    // deployment. No user is consulted anywhere in that decision.
    const actorless = {
      ...base,
      delegationContext: {
        kind: 'workflow_execution' as const,
        workflowId: 'workflow-1',
        principal: {
          kind: 'system' as const,
          serviceId: 'schedule' as const,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
        currentWorkflow: {
          workflowId: 'workflow-1',
          mode: 'deployment' as const,
          deploymentVersionId: 'version-1',
        },
      },
    }

    const result = await createCredentialGroupInviteLink.execute({
      principal: actorless,
      input: { workspaceId: 'workspace-1', email: 'person@example.com' },
    })

    expect(result.invitationLink).toBe('https://sim.ai/credential-groups/enroll/token-1')
    expect(mocks.createInvitationLink).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      undefined,
      'person@example.com'
    )
  })

  it('rejects delegation scoped to another workspace', async () => {
    await expect(
      createCredentialGroupInviteLink.execute({
        principal: executorPrincipal('workspace-2'),
        input: { workspaceId: 'workspace-1', email: 'person@example.com' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.createInvitationLink).not.toHaveBeenCalled()
  })

  it('requires the current subject to remain a workspace admin', async () => {
    resolvePermission.mockResolvedValue('write')

    await expect(
      createCredentialGroupInviteLink.execute({
        principal: executorPrincipal(),
        input: { workspaceId: 'workspace-1', email: 'person@example.com' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.createInvitationLink).not.toHaveBeenCalled()
  })
})
