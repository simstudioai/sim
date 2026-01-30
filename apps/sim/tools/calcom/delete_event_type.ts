import type {
  CalcomDeleteEventTypeParams,
  CalcomDeleteEventTypeResponse,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const deleteEventTypeTool: ToolConfig<
  CalcomDeleteEventTypeParams,
  CalcomDeleteEventTypeResponse
> = {
  id: 'calcom_delete_event_type',
  name: 'Cal.com Delete Event Type',
  description: 'Delete an event type from Cal.com',
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
      description: 'Event type ID to delete',
    },
  },

  request: {
    url: (params: CalcomDeleteEventTypeParams) =>
      `https://api.cal.com/v2/event-types/${params.eventTypeId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-14',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: data,
        error:
          data.error?.message || data.message || `Request failed with status ${response.status}`,
      }
    }

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
      description: 'Deleted event type details',
      properties: {
        id: { type: 'number', description: 'Event type ID' },
        lengthInMinutes: { type: 'number', description: 'Duration in minutes' },
        title: { type: 'string', description: 'Event type title' },
        slug: { type: 'string', description: 'Event type slug' },
      },
    },
  },
}
