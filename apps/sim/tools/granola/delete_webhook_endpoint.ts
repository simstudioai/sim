import type {
  GranolaDeleteWebhookEndpointParams,
  GranolaDeleteWebhookEndpointResponse,
} from '@/tools/granola/types'
import { GRANOLA_API_BASE, granolaHeaders, throwGranolaError } from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteWebhookEndpointTool: ToolConfig<
  GranolaDeleteWebhookEndpointParams,
  GranolaDeleteWebhookEndpointResponse
> = {
  id: 'granola_delete_webhook_endpoint',
  name: 'Granola Delete Webhook Endpoint',
  description:
    'Deletes a Granola webhook endpoint by ID, stopping its event deliveries immediately.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    webhookEndpointId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook endpoint ID (e.g., whe_2mKr8fQxLp7Ta3)',
    },
  },

  request: {
    url: (params) =>
      `${GRANOLA_API_BASE}/webhook-endpoints/${encodeURIComponent(params.webhookEndpointId.trim())}`,
    method: 'DELETE',
    headers: (params) => granolaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id ?? '',
        deleted: data.deleted ?? false,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted webhook endpoint' },
    deleted: { type: 'boolean', description: 'Whether the endpoint was deleted' },
  },
}
