import { normalizeWebhooks } from '@/tools/jotform/normalize'
import type { JotformListWebhooksParams, JotformWebhooksResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listWebhooksTool: ToolConfig<JotformListWebhooksParams, JotformWebhooksResponse> = {
  id: 'jotform_list_webhooks',
  name: 'Jotform List Webhooks',
  description:
    'List the webhooks registered on a form. The returned IDs are what the Delete Webhook operation takes.',
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
      description: 'ID of the form whose webhooks to list',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/webhooks`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Webhooks')

    return {
      success: true,
      output: { webhooks: normalizeWebhooks(envelope.content) },
    }
  },

  outputs: {
    webhooks: {
      type: 'array',
      description: 'Webhooks registered on the form',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook ID, used when deleting the webhook' },
          url: { type: 'string', description: 'URL that receives submission notifications' },
        },
      },
    },
  },
}
