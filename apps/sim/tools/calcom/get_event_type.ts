import type { CalcomGetEventTypeParams, CalcomGetEventTypeResponse } from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const getEventTypeTool: ToolConfig<CalcomGetEventTypeParams, CalcomGetEventTypeResponse> = {
  id: 'calcom_get_event_type',
  name: 'Cal.com Get Event Type',
  description: 'Get detailed information about a specific event type',
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
    eventTypeId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event type ID to retrieve',
    },
  },

  request: {
    url: (params: CalcomGetEventTypeParams) =>
      `https://api.cal.com/v2/event-types/${params.eventTypeId}`,
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
      type: 'object',
      description: 'Event type details',
      properties: {
        id: { type: 'number', description: 'Event type ID' },
        title: { type: 'string', description: 'Event type title' },
        slug: { type: 'string', description: 'Event type slug' },
        description: { type: 'string', description: 'Event type description' },
        lengthInMinutes: { type: 'number', description: 'Duration in minutes' },
        slotInterval: { type: 'number', description: 'Slot interval in minutes' },
        minimumBookingNotice: { type: 'number', description: 'Minimum booking notice in minutes' },
        beforeEventBuffer: { type: 'number', description: 'Buffer before event in minutes' },
        afterEventBuffer: { type: 'number', description: 'Buffer after event in minutes' },
        scheduleId: { type: 'number', description: 'Schedule ID' },
        disableGuests: { type: 'boolean', description: 'Whether guests are disabled' },
        createdAt: { type: 'string', description: 'ISO timestamp of creation' },
        updatedAt: { type: 'string', description: 'ISO timestamp of last update' },
      },
    },
  },
}
