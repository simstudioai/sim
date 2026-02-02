import type { CalcomListEventTypesParams, CalcomListEventTypesResponse } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const listEventTypesTool: ToolConfig<
  CalcomListEventTypesParams,
  CalcomListEventTypesResponse
> = {
  id: 'calcom_list_event_types',
  name: 'Cal.com List Event Types',
  description: 'Retrieve a list of all event types',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'calcom',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Cal.com OAuth access token',
    },
    sortCreatedAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by creation date: "asc" or "desc"',
    },
  },

  request: {
    url: (params: CalcomListEventTypesParams) => {
      const url = 'https://api.cal.com/v2/event-types'
      const queryParams: string[] = []

      if (params.sortCreatedAt) {
        queryParams.push(`sortCreatedAt=${encodeURIComponent(params.sortCreatedAt)}`)
      }

      return queryParams.length > 0 ? `${url}?${queryParams.join('&')}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-14',
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
    status: {
      type: 'string',
      description: 'Response status',
    },
    data: {
      type: 'array',
      description: 'Array of event types',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Event type ID' },
          title: { type: 'string', description: 'Event type title' },
          slug: { type: 'string', description: 'Event type slug' },
          description: { type: 'string', description: 'Event type description' },
          lengthInMinutes: { type: 'number', description: 'Duration in minutes' },
          slotInterval: { type: 'number', description: 'Slot interval in minutes' },
          minimumBookingNotice: {
            type: 'number',
            description: 'Minimum booking notice in minutes',
          },
          beforeEventBuffer: { type: 'number', description: 'Buffer before event in minutes' },
          afterEventBuffer: { type: 'number', description: 'Buffer after event in minutes' },
          scheduleId: { type: 'number', description: 'Schedule ID' },
          disableGuests: { type: 'boolean', description: 'Whether guests are disabled' },
          createdAt: { type: 'string', description: 'ISO timestamp of creation' },
          updatedAt: { type: 'string', description: 'ISO timestamp of last update' },
        },
      },
    },
  },
}
