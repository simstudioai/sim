import type {
  ExternalUserSubject,
  WebhookSystemPrincipal,
  WorkflowExecutionPrincipal,
} from '@sim/auth/principal'

export function normalizeWebhookPrincipalProvider(provider: string): string {
  if (!provider.trim()) throw new Error('Webhook execution provider must not be empty')
  return provider === 'slack_app' ? 'slack' : provider
}

export function createWebhookExecutionPrincipal(input: {
  webhookId: string
  workflowId: string
  workspaceId: string
  provider: string
  subject?: ExternalUserSubject
}): WebhookSystemPrincipal {
  const provider = normalizeWebhookPrincipalProvider(input.provider)
  if (!input.webhookId.trim()) throw new Error('Webhook execution requires a webhook ID')
  if (!input.workflowId.trim()) throw new Error('Webhook execution requires a workflow ID')
  if (!input.workspaceId.trim()) throw new Error('Webhook execution requires a workspace ID')
  if (input.subject && input.subject.provider !== provider) {
    throw new Error('Webhook execution subject provider must match the webhook provider')
  }
  return {
    kind: 'system',
    serviceId: 'webhook',
    webhookId: input.webhookId,
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    provider,
    ...(input.subject ? { subject: input.subject } : {}),
  }
}

export function assertWebhookExecutionPrincipal(
  principal: WorkflowExecutionPrincipal,
  expected: {
    webhookId: string
    workflowId: string
    workspaceId: string
    provider: string
  }
): asserts principal is WebhookSystemPrincipal {
  if (
    principal.kind !== 'system' ||
    principal.serviceId !== 'webhook' ||
    principal.webhookId !== expected.webhookId ||
    principal.workflowId !== expected.workflowId ||
    principal.workspaceId !== expected.workspaceId ||
    principal.provider !== normalizeWebhookPrincipalProvider(expected.provider)
  ) {
    throw new Error('Webhook job principal does not match its canonical execution scope')
  }
}
