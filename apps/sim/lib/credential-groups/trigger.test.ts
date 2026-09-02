/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decodePolicy: vi.fn(),
  fetchSubscriptions: vi.fn(),
  processEvent: vi.fn(),
  requirePolicy: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/workflow-access-policy', () => ({
  credentialGroupWorkflowAccessPolicyCodec: {
    resourceType: 'credential_group',
    parse: (value: unknown) => value,
  },
  decodeCredentialGroupWorkflowAccessPolicy: mocks.decodePolicy,
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
  workspaceId: 'workspace-1',
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

function subscription(params: {
  workflowId: string
  workspaceId?: string
  eventType?: string
  credentialGroupId?: string
}) {
  return {
    webhook: {
      id: `webhook-${params.workflowId}`,
      providerConfig: {
        triggerId: 'credential_group_event',
        credentialGroupId: params.credentialGroupId ?? 'group-1',
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
    mocks.requirePolicy.mockResolvedValue({ document: {} })
    mocks.decodePolicy.mockReturnValue(['workflow-allowed'])
    mocks.processEvent.mockResolvedValue({ success: true })
  })

  it('delivers only to an allowed workflow watching the exact group and event', async () => {
    const allowed = subscription({ workflowId: 'workflow-allowed' })
    mocks.fetchSubscriptions.mockResolvedValue([
      allowed,
      subscription({ workflowId: 'workflow-denied' }),
      subscription({ workflowId: 'workflow-allowed', eventType: 'form_submitted' }),
      subscription({ workflowId: 'workflow-allowed', credentialGroupId: 'group-2' }),
      subscription({ workflowId: 'workflow-allowed', workspaceId: 'workspace-2' }),
    ])

    await fireCredentialGroupTrigger(EVENT)

    expect(mocks.processEvent).toHaveBeenCalledOnce()
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

  it('does not scan subscriptions when no workflow has group access', async () => {
    mocks.decodePolicy.mockReturnValue([])

    await fireCredentialGroupTrigger(EVENT)

    expect(mocks.fetchSubscriptions).not.toHaveBeenCalled()
    expect(mocks.processEvent).not.toHaveBeenCalled()
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
