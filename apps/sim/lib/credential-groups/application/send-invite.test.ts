/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  inviteEnrollment: vi.fn(),
  loadInviter: vi.fn(),
  requireAvailable: vi.fn(),
  resolveGroup: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/context', () => ({
  requireCredentialGroupsAvailable: mocks.requireAvailable,
  resolveWorkspaceAccountsContext: mocks.resolveGroup,
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  inviteCredentialGroupEnrollment: mocks.inviteEnrollment,
  loadCredentialGroupInviterIdentity: mocks.loadInviter,
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

import { sendCredentialGroupInvite } from '@/lib/credential-groups/application/send-invite'

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

function executorPrincipal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'admin-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:credential-groups',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal: { kind: 'session', userId: 'admin-1', sessionId: 'session-1' },
      currentWorkflow: { workflowId: 'workflow-1', mode: 'draft' },
    },
  }
}

/** A deployed run whose only actor is the external identity that triggered it. */
function unattendedPrincipal(
  principal: NonNullable<WorkflowExecutionDelegatedPrincipal['delegationContext']>['principal']
): WorkflowExecutionDelegatedPrincipal {
  const { subjectUserId: _subject, ...base } = executorPrincipal()
  return {
    ...base,
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      principal,
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'version-1',
      },
    },
  }
}

function slackPrincipal(): WorkflowExecutionDelegatedPrincipal {
  return unattendedPrincipal({
    kind: 'system',
    serviceId: 'webhook',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    webhookId: 'webhook-1',
    provider: 'slack',
    subject: { kind: 'external_user', provider: 'slack', tenantId: 'T123', subjectId: 'U123' },
  })
}

function invite(principal: WorkflowExecutionDelegatedPrincipal) {
  return sendCredentialGroupInvite.execute({
    principal,
    input: { workspaceId: 'workspace-1', email: 'person@example.com' },
  })
}

describe('sendCredentialGroupInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveGroup.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.requireAvailable.mockResolvedValue(undefined)
    mocks.loadInviter.mockResolvedValue({ name: 'Ada Lovelace', email: 'ada@example.com' })
    mocks.inviteEnrollment.mockResolvedValue({
      id: 'enrollment-1',
      email: 'person@example.com',
      status: 'invited',
    })
  })

  it('invites without naming an inviter on a Slack-triggered run', async () => {
    const result = await invite(slackPrincipal())

    expect(result.enrollment.id).toBe('enrollment-1')
    expect(mocks.loadInviter).not.toHaveBeenCalled()
    expect(mocks.inviteEnrollment).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      undefined,
      undefined,
      'person@example.com'
    )
  })

  it('invites without naming an inviter on an actorless run', async () => {
    await invite(
      unattendedPrincipal({
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    )

    expect(mocks.inviteEnrollment).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      undefined,
      undefined,
      'person@example.com'
    )
  })

  it('names the human a session-actor run acts as', async () => {
    await invite(executorPrincipal())

    expect(mocks.loadInviter).toHaveBeenCalledWith('admin-1')
    expect(mocks.inviteEnrollment).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      'admin-1',
      'Ada Lovelace',
      'person@example.com'
    )
  })

  it('falls back to the inviter email when they have no name', async () => {
    mocks.loadInviter.mockResolvedValue({ name: '  ', email: 'ada@example.com' })

    await invite(executorPrincipal())

    expect(mocks.inviteEnrollment).toHaveBeenCalledWith(
      'workspace-1',
      'group-1',
      'admin-1',
      'ada@example.com',
      'person@example.com'
    )
  })

  it('requires the current subject to remain a workspace admin', async () => {
    mocks.resolvePermission.mockResolvedValue('write')

    await expect(invite(executorPrincipal())).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.inviteEnrollment).not.toHaveBeenCalled()
  })

  it('rejects a delegation asserting a subject its run never had', async () => {
    const spoofed = slackPrincipal()
    spoofed.subjectUserId = 'invented-user'

    await expect(invite(spoofed)).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.inviteEnrollment).not.toHaveBeenCalled()
  })
})
