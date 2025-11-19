import type {
  CalendlyListScheduledEventsParams,
  CalendlyListScheduledEventsResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const listScheduledEventsTool: ToolConfig<
  CalendlyListScheduledEventsParams,
  CalendlyListScheduledEventsResponse
> = {
  id: 'calendly_list_scheduled_events',
  name: 'Calendly List Scheduled Events',
  description: 'Retrieve a list of scheduled events for a user or organization',
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
      description: 'Return events that belong to this user (URI format)',
    },
    organization: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return events that belong to this organization (URI format)',
    },
    invitee_email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return events where invitee has this email',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (default: 20, max: 100)',
    },
    max_start_time: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return events with start time before this time (ISO 8601 format)',
    },
    min_start_time: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Return events with start time after this time (ISO 8601 format)',
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
      description: 'Sort order for results (e.g., "start_time:asc", "start_time:desc")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by status ("active" or "canceled")',
    },
  },

  request: {
    url: (params: CalendlyListScheduledEventsParams) => {
      const url = 'https://api.calendly.com/scheduled_events'
      const queryParams = []

      if (params.user) {
        queryParams.push(`user=${encodeURIComponent(params.user)}`)
      }

      if (params.organization) {
        queryParams.push(`organization=${encodeURIComponent(params.organization)}`)
      }

      if (params.invitee_email) {
        queryParams.push(`invitee_email=${encodeURIComponent(params.invitee_email)}`)
      }

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.max_start_time) {
        queryParams.push(`max_start_time=${encodeURIComponent(params.max_start_time)}`)
      }

      if (params.min_start_time) {
        queryParams.push(`min_start_time=${encodeURIComponent(params.min_start_time)}`)
      }

      if (params.pageToken) {
        queryParams.push(`page_token=${encodeURIComponent(params.pageToken)}`)
      }

      if (params.sort) {
        queryParams.push(`sort=${encodeURIComponent(params.sort)}`)
      }

      if (params.status) {
        queryParams.push(`status=${encodeURIComponent(params.status)}`)
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
      description: 'Array of scheduled event objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the event' },
          name: { type: 'string', description: 'Event name' },
          status: { type: 'string', description: 'Event status (active or canceled)' },
          start_time: { type: 'string', description: 'ISO timestamp of event start' },
          end_time: { type: 'string', description: 'ISO timestamp of event end' },
          event_type: { type: 'string', description: 'URI of the event type' },
          location: {
            type: 'object',
            description: 'Event location details',
            properties: {
              type: {
                type: 'string',
                description: 'Location type (e.g., "zoom", "google_meet", "physical")',
              },
              location: { type: 'string', description: 'Location description' },
              join_url: {
                type: 'string',
                description: 'URL to join online meeting (if applicable)',
              },
            },
          },
          invitees_counter: {
            type: 'object',
            description: 'Invitee count information',
            properties: {
              total: { type: 'number', description: 'Total number of invitees' },
              active: { type: 'number', description: 'Number of active invitees' },
              limit: { type: 'number', description: 'Maximum number of invitees' },
            },
          },
          created_at: { type: 'string', description: 'ISO timestamp of event creation' },
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
