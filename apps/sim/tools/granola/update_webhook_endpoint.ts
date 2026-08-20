import type {
  GranolaUpdateWebhookEndpointParams,
  GranolaUpdateWebhookEndpointResponse,
} from '@/tools/granola/types'
import {
  GRANOLA_API_BASE,
  granolaHeaders,
  mapWebhookEndpoint,
  throwGranolaError,
  toStringList,
} from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const updateWebhookEndpointTool: ToolConfig<
  GranolaUpdateWebhookEndpointParams,
  GranolaUpdateWebhookEndpointResponse
> = {
  id: 'granola_update_webhook_endpoint',
  name: 'Granola Update Webhook Endpoint',
  description:
    'Updates a Granola webhook endpoint. Each supplied field replaces its current value; omitted fields are left unchanged. Use enabled to pause or resume deliveries.',
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
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New HTTPS URL to deliver events to. Omit to leave unchanged.',
    },
    scopes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement scopes, comma-separated: personal, public. Omit to leave unchanged. A workspace-managed endpoint accepts only "workspace".',
    },
    events: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement event subscriptions, comma-separated: note.generated, note.edited, note.access_granted. Omit to leave unchanged.',
    },
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement folder filter, comma-separated folder IDs (max 100). Pass "[]" to remove the filter. Omit to leave unchanged.',
    },
    enabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pause (false) or resume (true) deliveries. Events that occur while paused are not delivered later. Omit to leave unchanged.',
    },
  },

  request: {
    url: (params) =>
      `${GRANOLA_API_BASE}/webhook-endpoints/${encodeURIComponent(params.webhookEndpointId.trim())}`,
    method: 'PATCH',
    headers: (params) => granolaHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.url?.trim()) body.url = params.url.trim()

      const scopes = toStringList(params.scopes)
      if (scopes.length > 0) body.scopes = scopes

      const events = toStringList(params.events)
      if (events.length > 0) body.events = events

      /* An explicit empty array clears the folder filter, so a blank string is
         the only value that means "leave unchanged". */
      if (typeof params.folderIds === 'string' && params.folderIds.trim()) {
        body.folder_ids = toStringList(params.folderIds)
      }

      if (params.enabled !== undefined && params.enabled !== null && params.enabled !== '') {
        body.enabled =
          typeof params.enabled === 'string' ? params.enabled === 'true' : params.enabled
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: mapWebhookEndpoint(data),
    }
  },

  outputs: {
    id: { type: 'string', description: 'Webhook endpoint ID' },
    url: { type: 'string', description: 'The HTTPS URL deliveries are sent to' },
    urlRedacted: {
      type: 'boolean',
      description:
        'Whether the returned URL was reduced to its origin because the caller is not the endpoint creator',
    },
    events: {
      type: 'array',
      description: 'Event names this endpoint is subscribed to',
      items: { type: 'string' },
    },
    folderIds: {
      type: 'array',
      description: 'Folder IDs delivery is restricted to, or an empty array when unrestricted',
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
}
