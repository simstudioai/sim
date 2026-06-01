import type { LinqListWebhookEventsParams, LinqListWebhookEventsResult } from '@/tools/linq/types'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'
import type { ToolConfig } from '@/tools/types'

export const linqListWebhookEventsTool: ToolConfig<
  LinqListWebhookEventsParams,
  LinqListWebhookEventsResult
> = {
  id: 'linq_list_webhook_events',
  name: 'List Webhook Events',
  description: 'List all webhook event types available to subscribe to',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Linq API key',
    },
  },

  request: {
    url: `${LINQ_API_BASE}/webhook-events`,
    method: 'GET',
    headers: (params) => linqHeaders(params.apiKey),
  },

  transformResponse: async (response): Promise<LinqListWebhookEventsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractLinqError(data, 'Failed to list webhook events'),
        output: { events: [], docUrl: null },
      }
    }

    return {
      success: true,
      output: {
        events: data.events ?? [],
        docUrl: data.doc_url ?? null,
      },
    }
  },

  outputs: {
    events: { type: 'json', description: 'Available webhook event type names' },
    docUrl: { type: 'string', description: 'Documentation URL for webhook events', optional: true },
  },
}
