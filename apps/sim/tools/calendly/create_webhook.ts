import type {
  CalendlyCreateWebhookParams,
  CalendlyCreateWebhookResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const createWebhookTool: ToolConfig<
  CalendlyCreateWebhookParams,
  CalendlyCreateWebhookResponse
> = {
  id: 'calendly_create_webhook',
  name: 'Calendly Create Webhook',
  description: 'Create a new webhook subscription to receive real-time event notifications',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'URL to receive webhook events (must be HTTPS)',
    },
    events: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description:
        'Array of event types to subscribe to (e.g., ["invitee.created", "invitee.canceled"])',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Organization URI',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'User URI (required for user-scoped webhooks)',
    },
    scope: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Webhook scope: "organization" or "user"',
    },
    signing_key: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional signing key to verify webhook signatures',
    },
  },

  request: {
    url: () => 'https://api.calendly.com/webhook_subscriptions',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CalendlyCreateWebhookParams) => {
      const body: any = {
        url: params.url,
        events: params.events,
        organization: params.organization,
        scope: params.scope,
      }

      if (params.user && params.scope === 'user') {
        body.user = params.user
      }

      if (params.signing_key) {
        body.signing_key = params.signing_key
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    resource: {
      type: 'object',
      description: 'Created webhook subscription details',
      properties: {
        uri: {
          type: 'string',
          description: 'Canonical reference to the webhook',
        },
        callback_url: {
          type: 'string',
          description: 'URL receiving webhook events',
        },
        created_at: {
          type: 'string',
          description: 'ISO timestamp of creation',
        },
        updated_at: {
          type: 'string',
          description: 'ISO timestamp of last update',
        },
        state: {
          type: 'string',
          description: 'Webhook state (active by default)',
        },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subscribed event types',
        },
        signing_key: {
          type: 'string',
          description: 'Key to verify webhook signatures',
        },
        scope: {
          type: 'string',
          description: 'Webhook scope',
        },
        organization: {
          type: 'string',
          description: 'Organization URI',
        },
        user: {
          type: 'string',
          description: 'User URI (for user-scoped webhooks)',
        },
        creator: {
          type: 'string',
          description: 'URI of user who created the webhook',
        },
      },
    },
  },
}
