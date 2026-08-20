import type {
  GranolaListWebhookEndpointsParams,
  GranolaListWebhookEndpointsResponse,
} from '@/tools/granola/types'
import {
  GRANOLA_API_BASE,
  granolaHeaders,
  mapWebhookEndpoint,
  throwGranolaError,
} from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const listWebhookEndpointsTool: ToolConfig<
  GranolaListWebhookEndpointsParams,
  GranolaListWebhookEndpointsResponse
> = {
  id: 'granola_list_webhook_endpoints',
  name: 'Granola List Webhook Endpoints',
  description:
    'Lists the Granola webhook endpoints the API key can manage. A personal key sees the endpoints it created; a workspace admin sees every endpoint in the workspace. Signing secrets are never included.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
  },

  request: {
    url: `${GRANOLA_API_BASE}/webhook-endpoints`,
    method: 'GET',
    headers: (params) => granolaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        webhookEndpoints: (data.webhook_endpoints ?? []).map(mapWebhookEndpoint),
      },
    }
  },

  outputs: {
    webhookEndpoints: {
      type: 'array',
      description: 'List of webhook endpoints',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Webhook endpoint ID' },
          url: {
            type: 'string',
            description:
              'The HTTPS URL deliveries are sent to, reduced to its origin when urlRedacted is true',
          },
          urlRedacted: {
            type: 'boolean',
            description:
              'Whether the URL was reduced to its origin because the caller is not the endpoint creator',
          },
          events: {
            type: 'array',
            description: 'Event names this endpoint is subscribed to',
            items: { type: 'string' },
          },
          folderIds: {
            type: 'array',
            description:
              'Folder IDs delivery is restricted to, or an empty array when unrestricted',
            items: { type: 'string' },
          },
          scopes: {
            type: 'array',
            description: 'Which notes this endpoint receives events for',
            items: { type: 'string' },
          },
          createdByName: {
            type: 'string',
            description: 'Name of the user who created the endpoint',
            optional: true,
          },
          createdByEmail: {
            type: 'string',
            description: 'Email of the user who created the endpoint',
            optional: true,
          },
          enabled: { type: 'boolean', description: 'Whether deliveries are active' },
          createdAt: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
  },
}
