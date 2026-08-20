import type {
  GranolaCreateWebhookEndpointParams,
  GranolaCreateWebhookEndpointResponse,
} from '@/tools/granola/types'
import {
  GRANOLA_API_BASE,
  granolaHeaders,
  mapWebhookEndpoint,
  throwGranolaError,
  toStringList,
} from '@/tools/granola/utils'
import type { ToolConfig } from '@/tools/types'

export const createWebhookEndpointTool: ToolConfig<
  GranolaCreateWebhookEndpointParams,
  GranolaCreateWebhookEndpointResponse
> = {
  id: 'granola_create_webhook_endpoint',
  name: 'Granola Create Webhook Endpoint',
  description:
    'Registers an HTTPS URL in Granola to receive note event deliveries. The signing secret is returned only by this operation and cannot be retrieved later.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Granola API key',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The publicly reachable HTTPS URL to deliver events to. Private network addresses are rejected.',
    },
    scopes: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Which notes to receive events for, comma-separated: personal, public. With a workspace API key pass exactly "workspace".',
    },
    events: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Event names to subscribe to, comma-separated: note.generated, note.edited, note.access_granted. Omit to subscribe to all events.',
    },
    folderIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restrict delivery to notes in these folders or their subfolders, comma-separated folder IDs (max 100). Omit for every note matching scopes.',
    },
  },

  request: {
    url: `${GRANOLA_API_BASE}/webhook-endpoints`,
    method: 'POST',
    headers: (params) => granolaHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        url: params.url.trim(),
        scopes: toStringList(params.scopes),
      }

      const events = toStringList(params.events)
      if (events.length > 0) body.events = events

      const folderIds = toStringList(params.folderIds)
      if (folderIds.length > 0) body.folder_ids = folderIds

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwGranolaError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        ...mapWebhookEndpoint(data),
        signingSecret: data.signing_secret ?? '',
      },
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
    signingSecret: {
      type: 'string',
      description:
        'Secret for verifying delivery signatures (Standard Webhooks HMAC-SHA256). Returned only here — store it securely.',
    },
  },
}
