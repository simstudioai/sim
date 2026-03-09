import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteWebhookParams, AttioDeleteWebhookResponse } from './types'

const logger = createLogger('AttioDeleteWebhook')

export const attioDeleteWebhookTool: ToolConfig<
  AttioDeleteWebhookParams,
  AttioDeleteWebhookResponse
> = {
  id: 'attio_delete_webhook',
  name: 'Attio Delete Webhook',
  description: 'Delete a webhook from Attio',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    webhookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The webhook ID to delete',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/webhooks/${params.webhookId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete webhook')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the webhook was deleted' },
  },
}
