import type { LinqDeleteWebhookSubscriptionParams, LinqSuccessResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqDeleteWebhookSubscriptionTool: ToolConfig<
  LinqDeleteWebhookSubscriptionParams,
  LinqSuccessResult
> = {
  id: 'linq_delete_webhook_subscription',
  name: 'Delete Webhook Subscription',
  description: 'Delete a webhook subscription from your account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
    subscriptionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the webhook subscription to delete',
    },
  },

  request: {
    url: (params) =>
      `${LINQ_API_BASE}/webhook-subscriptions/${encodeURIComponent(params.subscriptionId.trim())}`,
    method: 'DELETE',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqSuccessResult> => {
    if (response.ok) {
      return { success: true, output: { success: true } }
    }
    const data = await response.json().catch(() => null)
    return {
      success: false,
      error: extractLinqError(data, 'Failed to delete webhook subscription'),
      output: { success: false },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the subscription was deleted' },
  },
}
