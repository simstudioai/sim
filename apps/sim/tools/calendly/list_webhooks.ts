import type {
  CalendlyListWebhooksParams,
  CalendlyListWebhooksResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const listWebhooksTool: ToolConfig<
  CalendlyListWebhooksParams,
  CalendlyListWebhooksResponse
> = {
  id: 'calendly_list_webhooks',
  name: 'Calendly List Webhooks',
  description: 'Retrieve a list of webhook subscriptions for an organization',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    organization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Organization URI to list webhooks for. Format: URI (e.g., "https://api.calendly.com/organizations/abc123-def456")',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page. Format: integer (default: 20, max: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Page token for pagination. Format: opaque string from previous response next_page_token',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by scope. Format: "organization" or "user"',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter webhooks by user URI (for user-scoped webhooks). Format: URI (e.g., "https://api.calendly.com/users/abc123-def456")',
    },
  },

  request: {
    url: (params: CalendlyListWebhooksParams) => {
      const url = 'https://api.calendly.com/webhook_subscriptions'
      const queryParams = []

      queryParams.push(`organization=${encodeURIComponent(params.organization)}`)

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.pageToken) {
        queryParams.push(`page_token=${encodeURIComponent(params.pageToken)}`)
      }

      if (params.scope) {
        queryParams.push(`scope=${encodeURIComponent(params.scope)}`)
      }

      if (params.user) {
        queryParams.push(`user=${encodeURIComponent(params.user)}`)
      }

      return `${url}?${queryParams.join('&')}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    collection: {
      type: 'array',
      description: 'Array of webhook subscription objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the webhook' },
          callback_url: { type: 'string', description: 'URL to receive webhook events' },
          created_at: { type: 'string', description: 'ISO timestamp of creation' },
          updated_at: { type: 'string', description: 'ISO timestamp of last update' },
          state: { type: 'string', description: 'Webhook state (active, disabled, etc.)' },
          events: {
            type: 'array',
            items: { type: 'string' },
            description: 'Event types this webhook subscribes to',
          },
          signing_key: { type: 'string', description: 'Key to verify webhook signatures' },
          scope: { type: 'string', description: 'Webhook scope (organization or user)' },
          organization: { type: 'string', description: 'Organization URI' },
          user: { type: 'string', description: 'User URI (for user-scoped webhooks)' },
          creator: { type: 'string', description: 'URI of user who created the webhook' },
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination information',
      properties: {
        count: { type: 'number', description: 'Number of results in this page' },
        next_page: { type: 'string', description: 'URL to next page (if available)' },
        previous_page: { type: 'string', description: 'URL to previous page (if available)' },
        next_page_token: { type: 'string', description: 'Token for next page' },
        previous_page_token: { type: 'string', description: 'Token for previous page' },
      },
    },
  },
}
