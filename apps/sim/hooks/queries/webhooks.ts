import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ListWebhooksByBlockResponse,
  listWebhooksByBlockContract,
  updateWebhookContract,
  type WebhookData,
} from '@/lib/api/contracts/webhooks'

export const WEBHOOK_DETAIL_STALE_TIME = 60 * 1000

export const webhookKeys = {
  all: ['webhooks'] as const,
  details: () => [...webhookKeys.all, 'detail'] as const,
  byBlock: (workflowId?: string, blockId?: string) =>
    [...webhookKeys.details(), workflowId ?? '', blockId ?? ''] as const,
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
    staleTime: WEBHOOK_DETAIL_STALE_TIME,
  })
}

interface ReactivateWebhookVariables {
  webhookId: string
  workflowId: string
  blockId: string
}

/**
 * Reactivates a disabled webhook and invalidates the block's webhook query so
 * the shared cache (read by useWebhookQuery / useWebhookManagement) reflects the
 * new active state immediately instead of serving the stale value for staleTime.
 */
export function useReactivateWebhook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ webhookId }: ReactivateWebhookVariables) =>
      requestJson(updateWebhookContract, {
        params: { id: webhookId },
        body: { isActive: true, failedCount: 0 },
      }),
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({
        queryKey: webhookKeys.byBlock(variables.workflowId, variables.blockId),
      }),
  })
}
