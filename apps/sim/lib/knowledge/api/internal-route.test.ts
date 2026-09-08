/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import {
  BILLING_ATTRIBUTION_HEADER,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  internalKnowledgeAnalytics,
  internalKnowledgeProvenanceUserId,
  resolveInternalKnowledgeBillingAttribution,
  toInternalKnowledgeConnector,
} from '@/lib/knowledge/api/internal-route'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: capture }))

const BILLING_ATTRIBUTION = {
  actorUserId: 'execution-billing-actor-1',
  billedAccountUserId: 'billing-owner-1',
  billingEntity: { type: 'user' as const, id: 'billing-owner-1' },
  billingPeriod: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-09-01T00:00:00.000Z',
  },
  organizationId: null,
  payerSubscription: null,
  workspaceId: 'workspace-1',
}

function request(): NextRequest {
  return new NextRequest('http://localhost/api/knowledge/search', {
    headers: {
      [BILLING_ATTRIBUTION_HEADER]: serializeBillingAttributionHeader(BILLING_ATTRIBUTION),
    },
  })
}

function executorPrincipal(
  originalPrincipal: NonNullable<
    WorkflowExecutionDelegatedPrincipal['delegationContext']
  >['principal']
): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: 'workspace-1',
    delegationId: 'executor-1',
    audience: 'sim:knowledge',
    issuedAt: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
      compatibilityActor: {
        kind: 'legacy_execution_user',
        userId: 'execution-billing-actor-1',
      },
      ...(originalPrincipal ? { principal: originalPrincipal } : {}),
    },
  }
}

describe('internal Knowledge execution attribution', () => {
  it.each([
    {
      name: 'generic webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'generic',
      },
    },
    {
      name: 'Slack webhook',
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        webhookId: 'webhook-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'tenant-1',
          subjectId: 'subject-1',
        },
      },
    },
  ])('restores billing and provenance attribution for a $name execution', async ({ principal }) => {
    const executor = executorPrincipal(principal)

    await expect(
      resolveInternalKnowledgeBillingAttribution(request(), executor, 'workspace-1')
    ).resolves.toEqual(BILLING_ATTRIBUTION)
    expect(internalKnowledgeProvenanceUserId(request().headers, executor, 'workspace-1')).toBe(
      'execution-billing-actor-1'
    )
    expect(
      resolveKnowledgeAttributedUserId(executor, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
    ).toBe('execution-billing-actor-1')
  })

  it('rejects a billing snapshot from another workspace', async () => {
    const principal = executorPrincipal({
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })

    await expect(
      resolveInternalKnowledgeBillingAttribution(request(), principal, 'workspace-2')
    ).rejects.toThrow('does not match the authenticated request scope')
  })
})

describe('toInternalKnowledgeConnector', () => {
  const row = {
    id: 'connector-1',
    knowledgeBaseId: 'kb-1',
    connectorType: 'google_drive',
    credentialId: null,
    sourceConfig: {},
    syncMode: null,
    syncIntervalMinutes: 60,
    status: 'active' as const,
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    accessMode: 'members' as const,
    credentialGroupId: 'group-1',
    credentialGroupOptionId: 'option-1',
    memberSyncStatus: 'idle' as const,
    lastMemberSyncAt: null,
    nextMemberSyncAt: null,
    lastMemberSyncError: null,
    memberSyncConsecutiveFailures: 0,
    accessRewritePending: false,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }

  it('presents a mutation result, which carries no viewer membership, as null', () => {
    expect(toInternalKnowledgeConnector(row).viewerMembership).toBeNull()
  })

  it('keeps the membership a read resolved for the viewer', () => {
    expect(
      toInternalKnowledgeConnector({ ...row, viewerMembership: 'invited' }).viewerMembership
    ).toBe('invited')
  })
})

describe('connector sync analytics', () => {
  it.each([
    { owner: { workspaceId: 'workspace' }, groups: { workspace: 'workspace' } },
    { owner: { organizationId: 'organization' }, groups: { organization: 'organization' } },
  ])('preserves the canonical owner $owner', ({ owner, groups }) => {
    capture.mockClear()
    internalKnowledgeAnalytics.connectorSynced({
      principal: { kind: 'session', userId: 'actor', sessionId: 'session' },
      input: {},
      result: { knowledgeBaseId: 'index', connectorType: 'gmail', ...owner },
    })
    expect(capture).toHaveBeenCalledWith(
      'actor',
      'knowledge_base_connector_synced',
      expect.objectContaining({ knowledge_base_id: 'index' }),
      { groups }
    )
  })
})
