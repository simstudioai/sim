import type {
  CalendlyDeleteWebhookParams,
  CalendlyDeleteWebhookResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const deleteWebhookTool: ToolConfig<
  CalendlyDeleteWebhookParams,
  CalendlyDeleteWebhookResponse
> = {
  id: 'calendly_delete_webhook',
  name: 'Calendly Delete Webhook',
  description: 'Delete a webhook subscription',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    webhookUuid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Webhook subscription UUID to delete. Format: UUID (e.g., "abc123-def456") or full URI (e.g., "https://api.calendly.com/webhook_subscriptions/abc123-def456")',
    },
  },

  request: {
    url: (params: CalendlyDeleteWebhookParams) => {
      const uuid = params.webhookUuid.includes('/')
        ? params.webhookUuid.split('/').pop()
        : params.webhookUuid
      return `https://api.calendly.com/webhook_subscriptions/${uuid}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (response.status === 204 || response.status === 200) {
      return {
        success: true,
        output: {
          deleted: true,
          message: 'Webhook subscription deleted successfully',
        },
      }
    }

    const data = await response.json()
    return {
      success: false,
      output: {
        deleted: false,
        message: data.message || 'Failed to delete webhook subscription',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the webhook was successfully deleted',
    },
    message: {
      type: 'string',
      description: 'Status message',
    },
  },
}
