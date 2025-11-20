import type {
  CalendlyListEventInviteesParams,
  CalendlyListEventInviteesResponse,
} from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const listEventInviteesTool: ToolConfig<
  CalendlyListEventInviteesParams,
  CalendlyListEventInviteesResponse
> = {
  id: 'calendly_list_event_invitees',
  name: 'Calendly List Event Invitees',
  description: 'Retrieve a list of invitees for a scheduled event',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Calendly Personal Access Token',
    },
    eventUuid: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Scheduled event UUID (can be full URI or just the UUID)',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of results per page (default: 20, max: 100)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter invitees by email address',
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
      description: 'Sort order for results (e.g., "created_at:asc", "created_at:desc")',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by status ("active" or "canceled")',
    },
  },

  request: {
    url: (params: CalendlyListEventInviteesParams) => {
      const uuid = params.eventUuid.includes('/')
        ? params.eventUuid.split('/').pop()
        : params.eventUuid
      const url = `https://api.calendly.com/scheduled_events/${uuid}/invitees`
      const queryParams = []

      if (params.count) {
        queryParams.push(`count=${Number(params.count)}`)
      }

      if (params.email) {
        queryParams.push(`email=${encodeURIComponent(params.email)}`)
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
      description: 'Array of invitee objects',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: 'Canonical reference to the invitee' },
          email: { type: 'string', description: 'Invitee email address' },
          name: { type: 'string', description: 'Invitee full name' },
          first_name: { type: 'string', description: 'Invitee first name' },
          last_name: { type: 'string', description: 'Invitee last name' },
          status: { type: 'string', description: 'Invitee status (active or canceled)' },
          questions_and_answers: {
            type: 'array',
            description: 'Responses to custom questions',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'Question text' },
                answer: { type: 'string', description: 'Invitee answer' },
                position: { type: 'number', description: 'Question order' },
              },
            },
          },
          timezone: { type: 'string', description: 'Invitee timezone' },
          event: { type: 'string', description: 'URI of the scheduled event' },
          created_at: { type: 'string', description: 'ISO timestamp when invitee was created' },
          updated_at: { type: 'string', description: 'ISO timestamp when invitee was updated' },
          cancel_url: { type: 'string', description: 'URL to cancel the booking' },
          reschedule_url: { type: 'string', description: 'URL to reschedule the booking' },
          rescheduled: { type: 'boolean', description: 'Whether invitee rescheduled' },
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
