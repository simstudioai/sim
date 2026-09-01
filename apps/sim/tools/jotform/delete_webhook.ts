import { normalizeWebhooks } from '@/tools/jotform/normalize'
import type { JotformDeleteWebhookParams, JotformWebhooksResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteWebhookTool: ToolConfig<JotformDeleteWebhookParams, JotformWebhooksResponse> = {
  id: 'jotform_delete_webhook',
  name: 'Jotform Delete Webhook',
  description:
    'Remove a webhook from a form. Returns the webhooks that remain registered on the form.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the form the webhook belongs to',
    },
    webhookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Webhook ID, available from the List Webhooks operation',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/webhooks/${encodeURIComponent(
          requireValue(params.webhookId, 'webhookId')
        )}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Webhook')

    return {
      success: true,
      output: { webhooks: normalizeWebhooks(envelope.content) },
    }
  },

  outputs: {
    webhooks: {
      type: 'array',
      description: 'Webhooks still registered on the form after the deletion',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook ID' },
          url: { type: 'string', description: 'URL that receives submission notifications' },
        },
      },
    },
  },
}
