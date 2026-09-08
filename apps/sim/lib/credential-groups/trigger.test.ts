/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { buildOrganizationAccountAccessPolicy } from '@/lib/credential-groups/application/workspace-access-policy'

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  requireAccess: vi.fn(),
  fetchSubscriptions: vi.fn(),
  processEvent: vi.fn(),
  requirePolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/organization-workspace-access', () => ({
  resolveOrganizationAccountsWorkspaceContext: mocks.resolveWorkspace,
  requireOrganizationAccountsWorkspaceAccess: mocks.requireAccess,
}))

vi.mock('@/lib/resource-policies/repository', () => ({
  requireResourcePolicy: mocks.requirePolicy,
}))

vi.mock('@/lib/credential-groups/trigger-subscriptions', () => ({
  fetchCredentialGroupTriggerSubscriptions: mocks.fetchSubscriptions,
}))

vi.mock('@/lib/webhooks/processor', () => ({
  processPolledWebhookEvent: mocks.processEvent,
}))

import {
  buildCredentialGroupTriggerPayload,
  fireCredentialGroupTrigger,
} from '@/lib/credential-groups/trigger'

const EVENT = {
  event: 'credential_added' as const,
  organizationId: 'org-1',
  credentialGroupId: 'group-1',
  credentialGroupName: 'Credential Group',
  enrollmentId: 'enrollment-1',
  email: 'person@example.com',
  enrollmentStatus: 'in_progress' as const,
  credential: {
    credentialId: 'credential-1',
    credentialGroupOptionId: 'option-1',
    provider: 'gmail' as const,
    providerId: 'google-email',
    displayName: 'person@example.com',
  },
}

function subscription(params: { workflowId: string; workspaceId?: string; eventType?: string }) {
  return {
    webhook: {
      id: `webhook-${params.workflowId}`,
      providerConfig: {
        triggerId: 'credential_group_event',
        eventType: params.eventType ?? 'credential_added',
      },
    },
    workflow: {
      id: params.workflowId,
      workspaceId: params.workspaceId ?? 'workspace-1',
    },
  }
}

describe('Credential Group trigger delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', ['workspace-1', 'workspace-2']),
    })
    mocks.resolveWorkspace.mockImplementation(async (workspaceId: string) => ({
      workspaceId,
      credentialGroupId: 'group-1',
      status: 'active',
    }))
    mocks.requireAccess.mockResolvedValue(undefined)
    mocks.processEvent.mockResolvedValue({ success: true })
  })

  it('delivers to matching subscribers across allowed workspaces without workflow grants', async () => {
    const allowed = subscription({ workflowId: 'workflow-allowed' })
    mocks.fetchSubscriptions.mockResolvedValue([
      allowed,
      subscription({ workflowId: 'workflow-denied' }),
      subscription({ workflowId: 'workflow-allowed', eventType: 'form_submitted' }),
      subscription({ workflowId: 'workflow-allowed', workspaceId: 'workspace-2' }),
    ])

    await fireCredentialGroupTrigger(EVENT)

    expect(mocks.processEvent).toHaveBeenCalledTimes(3)
    expect(mocks.processEvent).toHaveBeenCalledWith(
      allowed.webhook,
      allowed.workflow,
      expect.objectContaining({
        event: 'credential_added',
        credentialGroupId: 'group-1',
        credentialId: 'credential-1',
      }),
      expect.any(String)
    )
  })

  it('does not scan subscriptions when no workspace has access', async () => {
    mocks.requirePolicy.mockResolvedValue({
      document: buildOrganizationAccountAccessPolicy('group-1', []),
    })

    await fireCredentialGroupTrigger(EVENT)

    expect(mocks.fetchSubscriptions).not.toHaveBeenCalled()
    expect(mocks.processEvent).not.toHaveBeenCalled()
  })

  it('skips a workspace revoked during fanout and continues to other subscribers', async () => {
    mocks.fetchSubscriptions.mockResolvedValue([
      subscription({ workflowId: 'revoked' }),
      subscription({ workflowId: 'allowed', workspaceId: 'workspace-2' }),
    ])
    mocks.requireAccess.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Revoked'))
    await fireCredentialGroupTrigger(EVENT)
    expect(mocks.processEvent).toHaveBeenCalledOnce()
    expect(mocks.processEvent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: 'allowed' }),
      expect.any(Object),
      expect.any(String)
    )
  })

  it('propagates malformed policy and delivery failures', async () => {
    mocks.requirePolicy.mockRejectedValueOnce(new Error('Malformed policy'))
    await expect(fireCredentialGroupTrigger(EVENT)).rejects.toThrow('Malformed policy')
    mocks.fetchSubscriptions.mockResolvedValue([subscription({ workflowId: 'allowed' })])
    mocks.processEvent.mockResolvedValue({ success: false, statusCode: 500, error: 'Failed' })
    await expect(fireCredentialGroupTrigger(EVENT)).rejects.toThrow('Failed to deliver')
  })

  it('uses null credential fields for form submissions', () => {
    expect(
      buildCredentialGroupTriggerPayload({
        event: 'form_submitted',
        workspaceId: 'workspace-1',
        credentialGroupId: 'group-1',
        credentialGroupName: 'Credential Group',
        enrollmentId: 'enrollment-1',
        email: 'person@example.com',
        enrollmentStatus: 'completed',
      })
    ).toEqual(
      expect.objectContaining({
        event: 'form_submitted',
        credentialId: null,
        credentialGroupOptionId: null,
        provider: null,
        providerId: null,
        displayName: null,
      })
    )
  })
})
