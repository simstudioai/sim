import { useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ListWebhooksByBlockResponse,
  listWebhooksByBlockContract,
  type WebhookData,
} from '@/lib/api/contracts/webhooks'

export const webhookKeys = {
  all: ['webhooks'] as const,
  byBlock: (workflowId: string, blockId: string) =>
    [...webhookKeys.all, workflowId, blockId] as const,
}

export type { WebhookData }

async function fetchWebhooks(
  workflowId: string,
  blockId: string,
  signal?: AbortSignal
): Promise<WebhookData | null> {
  let data: ListWebhooksByBlockResponse
  try {
    data = await requestJson(listWebhooksByBlockContract, {
      query: { workflowId, blockId },
      signal,
    })
  } catch (error) {
    if (isApiClientError(error) && error.status === 404) return null
    throw error
  }

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
