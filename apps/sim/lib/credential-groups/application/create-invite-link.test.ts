/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInvitationLink: vi.fn(),
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupsAvailable: mocks.requireAvailable,
  resolveWorkspaceAccountsContext: mocks.resolveGroup,
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  createCredentialGroupInvitationLink: mocks.createInvitationLink,
  CredentialGroupEnrollmentError: class CredentialGroupEnrollmentError extends Error {
    constructor(
      message: string,
      readonly status: 400 | 404 | 409 | 502
    ) {
      super(message)
    }
  },
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { createCredentialGroupInviteLink } from '@/lib/credential-groups/application/create-invite-link'

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

function executorPrincipal(workspaceId = 'workspace-1'): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'admin-1',
    workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: { kind: 'workflow_execution', workflowId: 'workflow-1' },
  }
}

describe('createCredentialGroupInviteLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGroup.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
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

  it('allows only admin executor delegation', () => {
    expect(createCredentialGroupInviteLink.operation).toMatchObject({
      id: 'credential_groups.invites.link.create',
      minimumRole: 'admin',
      workspaceApiKey: 'deny',
      principalKinds: ['delegated'],
      delegatedServices: ['executor'],
    })
  })

  it('rejects unsupported principals before loading the group', async () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'admin-1',
      sessionId: 'session-1',
    }

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
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(
      createCredentialGroupInviteLink.execute({
        principal: executorPrincipal(),
        input: { workspaceId: 'workspace-1', email: 'person@example.com' },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.createInvitationLink).not.toHaveBeenCalled()
  })

  it('normalizes the recipient and returns the newly issued bearer link', async () => {
    const result = await createCredentialGroupInviteLink.execute({
      principal: executorPrincipal(),
      input: { workspaceId: 'workspace-1', email: ' Person@Example.COM ' },
    })

    expect(mocks.requireAvailable).toHaveBeenCalledWith('workspace-1')
    expect(mocks.createInvitationLink).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      'admin-1',
      'person@example.com'
    )
    expect(result.invitationLink).toBe('https://sim.ai/credential-groups/enroll/token-1')
  })

  it('rejects an invalid email before issuing a token', async () => {
    await expect(
      createCredentialGroupInviteLink.execute({
        principal: executorPrincipal(),
        input: { workspaceId: 'workspace-1', email: 'not-an-email' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.requireAvailable).not.toHaveBeenCalled()
    expect(mocks.createInvitationLink).not.toHaveBeenCalled()
  })
})
