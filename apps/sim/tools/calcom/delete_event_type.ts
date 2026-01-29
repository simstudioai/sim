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
      visibility: 'user-only',
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
    if (response.status === 204 || response.status === 200) {
      return {
        success: true,
        output: {
          deleted: true,
          message: 'Event type deleted successfully',
        },
      }
    }

    const data = await response.json()
    return {
      success: false,
      output: {
        deleted: false,
        message: data.message || 'Failed to delete event type',
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'Whether the event type was successfully deleted',
    },
    message: {
      type: 'string',
      description: 'Status message',
    },
  },
}
