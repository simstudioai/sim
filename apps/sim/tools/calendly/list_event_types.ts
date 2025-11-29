import type {
  CalendlyListEventTypesParams,
  CalendlyListEventTypesResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const listEventTypesTool: ToolConfig<
  CalendlyListEventTypesParams,
  CalendlyListEventTypesResponse
> = {
  id: 'calendly_list_event_types',
  name: 'Calendly List Event Types',
  description: 'Retrieve a list of all event types for a user or organization',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    user: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return only event types that belong to this user (URI format)',
    },
    organization: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return only event types that belong to this organization (URI format)',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (default: 20, max: 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Page token for pagination',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Sort order for results (e.g., "name:asc", "name:desc")',
    },
    active: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'When true, show only active event types. When false or unchecked, show all event types (both active and inactive).',
    },
  },

  request: {
    url: (params: CalendlyListEventTypesParams) => {
      const url = 'https://api.calendly.com/event_types'
      const queryParams = []

      if (params.user) {
        queryParams.push(`user=${encodeURIComponent(params.user)}`)
      }

      if (params.organization) {
        queryParams.push(`organization=${encodeURIComponent(params.organization)}`)
      }

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.pageToken) {
        queryParams.push(`page_token=${encodeURIComponent(params.pageToken)}`)
      }

      if (params.sort) {
        queryParams.push(`sort=${encodeURIComponent(params.sort)}`)
      }

      if (params.active === true) {
        queryParams.push('active=true')
      }

      return queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url
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
      description: 'Array of event type objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the event type' },
          name: { type: 'string', description: 'Event type name' },
          active: { type: 'boolean', description: 'Whether the event type is active' },
          booking_method: {
            type: 'string',
            description: 'Booking method (e.g., "round_robin_or_collect", "collective")',
          },
          color: { type: 'string', description: 'Hex color code' },
          created_at: { type: 'string', description: 'ISO timestamp of creation' },
          description_html: { type: 'string', description: 'HTML formatted description' },
          description_plain: { type: 'string', description: 'Plain text description' },
          duration: { type: 'number', description: 'Duration in minutes' },
          scheduling_url: { type: 'string', description: 'URL to scheduling page' },
          slug: { type: 'string', description: 'Unique identifier for URLs' },
          type: { type: 'string', description: 'Event type classification' },
          updated_at: { type: 'string', description: 'ISO timestamp of last update' },
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
