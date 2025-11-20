import type { CalendlyCancelEventParams, CalendlyCancelEventResponse } from '@/tools/calendly/types'
import type { ToolConfig } from '@/tools/types'

export const cancelEventTool: ToolConfig<CalendlyCancelEventParams, CalendlyCancelEventResponse> = {
  id: 'calendly_cancel_event',
  name: 'Calendly Cancel Event',
  description: 'Cancel a scheduled event',
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
      description: 'Scheduled event UUID to cancel (can be full URI or just the UUID)',
    },
    reason: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Reason for cancellation (will be sent to invitees)',
    },
  },

  request: {
    url: (params: CalendlyCancelEventParams) => {
      const uuid = params.eventUuid.includes('/')
        ? params.eventUuid.split('/').pop()
        : params.eventUuid
      return `https://api.calendly.com/scheduled_events/${uuid}/cancellation`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params: CalendlyCancelEventParams) => {
      const body: any = {}

      if (params.reason) {
        body.reason = params.reason
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
      description: 'Cancellation details',
      properties: {
        canceler_type: {
          type: 'string',
          description: 'Type of canceler (host or invitee)',
        },
        canceled_by: {
          type: 'string',
          description: 'Name of person who canceled',
        },
        reason: {
          type: 'string',
          description: 'Cancellation reason',
        },
        created_at: {
          type: 'string',
          description: 'ISO timestamp when event was canceled',
        },
      },
    },
  },
}
