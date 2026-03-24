import { useQuery } from '@tanstack/react-query'

export const webhookKeys = {
  all: ['webhooks'] as const,
  byBlock: (workflowId: string, blockId: string) =>
    [...webhookKeys.all, workflowId, blockId] as const,
}

interface WebhookProviderConfig {
  triggerId?: string
  credentialId?: string
  credentialSetId?: string
  userId?: string
  historyId?: string
  lastCheckedTimestamp?: string
  setupCompleted?: boolean
  externalId?: string
  blockId?: string
  [key: string]: unknown
}

export interface WebhookData {
  id: string
  path?: string
  providerConfig?: WebhookProviderConfig
}

interface WebhookResponse {
  webhooks: Array<{
    webhook: WebhookData
  }>
}

async function fetchWebhooks(
  workflowId: string,
  blockId: string,
  signal?: AbortSignal
): Promise<WebhookData | null> {
  const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`, {
    signal,
  })

  if (!response.ok) {
    return null
  }

  const data: WebhookResponse = await response.json()

  if (data.webhooks && data.webhooks.length > 0) {
    return data.webhooks[0].webhook
  }

  return null
}

export function useWebhookQuery(workflowId: string, blockId: string, enabled = true) {
  return useQuery({
    queryKey: webhookKeys.byBlock(workflowId, blockId),
    queryFn: ({ signal }) => fetchWebhooks(workflowId, blockId, signal),
    enabled: enabled && Boolean(workflowId && blockId),
    staleTime: 60 * 1000,
  })
}
