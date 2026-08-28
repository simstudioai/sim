/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import {
  BILLING_ATTRIBUTION_HEADER,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import {
  internalKnowledgeProvenanceUserId,
  resolveInternalKnowledgeBillingAttribution,
} from '@/lib/knowledge/api/internal-route'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'

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
      'billing-owner-1'
    )
    expect(
      resolveKnowledgeAttributedUserId(executor, {
        workspaceId: 'workspace-1',
        workspaceOrganizationId: null,
        allowPersonalApiKeys: true,
        billedAccountUserId: 'billing-owner-1',
      })
    ).toBe('billing-owner-1')
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
