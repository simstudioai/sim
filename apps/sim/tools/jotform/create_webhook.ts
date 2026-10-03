import { normalizeWebhooks } from '@/tools/jotform/normalize'
import type { JotformCreateWebhookParams, JotformWebhooksResponse } from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  requireValue,
  toFormBody,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createWebhookTool: ToolConfig<JotformCreateWebhookParams, JotformWebhooksResponse> = {
  id: 'jotform_create_webhook',
  name: 'Jotform Create Webhook',
  description:
    'Register a webhook on a form so every new submission is posted to the given URL. Returns the full webhook list for the form.',
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
      description: 'ID of the form to add the webhook to',
    },
    webhookUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL that Jotform posts submission data to',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/webhooks`
      ).toString(),
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => toFormBody({ webhookURL: requireValue(params.webhookUrl, 'webhookUrl') }),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Webhook')

    return {
      success: true,
      output: { webhooks: normalizeWebhooks(envelope.content) },
    }
  },

  outputs: {
    webhooks: {
      type: 'array',
      description: 'Webhooks registered on the form after the addition',
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
