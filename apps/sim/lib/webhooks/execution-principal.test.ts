/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  assertWebhookExecutionPrincipal,
  createWebhookExecutionPrincipal,
} from '@/lib/webhooks/execution-principal'

describe('webhook execution principals', () => {
  it('represents a generic webhook without inventing a person', () => {
    const principal = createWebhookExecutionPrincipal({
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      provider: 'generic',
    })

    expect(principal.subject).toBeUndefined()
    expect(() =>
      assertWebhookExecutionPrincipal(principal, {
        webhookId: 'webhook-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        provider: 'generic',
      })
    ).not.toThrow()
  })

  it('preserves a verified external webhook actor', () => {
    const subject = {
      kind: 'external_user' as const,
      provider: 'slack',
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
    }
    const principal = createWebhookExecutionPrincipal({
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      provider: 'slack',
      subject,
    })

    expect(principal.subject).toEqual(subject)
  })

  it('rejects an external actor from another provider', () => {
    expect(() =>
      createWebhookExecutionPrincipal({
        webhookId: 'webhook-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        provider: 'generic',
        subject: {
          kind: 'external_user',
          provider: 'slack',
          tenantId: 'tenant-1',
          subjectId: 'subject-1',
        },
      })
    ).toThrow('Webhook execution subject provider must match the webhook provider')
  })
})
