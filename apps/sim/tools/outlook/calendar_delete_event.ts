import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildEventUrl, CALENDAR_RETRY } from '@/tools/outlook/calendar-utils'
import type {
  OutlookCalendarDeleteEventParams,
  OutlookCalendarDeleteEventResponse,
} from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookCalendarDeleteEventTool: ToolConfig<
  OutlookCalendarDeleteEventParams,
  OutlookCalendarDeleteEventResponse
> = {
  id: 'outlook_calendar_delete_event',
  name: 'Outlook Delete Calendar Event',
  description: 'Delete an Outlook calendar event by ID',
  version: '1.0.0',

  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the calendar event to delete',
    },
  },

  request: {
    url: (params) => buildEventUrl(params.eventId),
    method: 'DELETE',
    retry: CALENDAR_RETRY,
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
  },

  // Graph returns 204 No Content on success, so there is no body to read.
  transformResponse: async (response: Response, params?: OutlookCalendarDeleteEventParams) => {
    const status = response.status

    return {
      success: true,
      output: {
        message:
          status === 204 || status === 200
            ? 'Event deleted successfully'
            : `Event deleted (HTTP ${status})`,
        results: {
          eventId: params?.eventId ?? '',
          status: 'deleted',
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'Delete result details',
      properties: {
        eventId: { type: 'string', description: 'ID of the deleted event' },
        status: { type: 'string', description: 'Deletion status' },
      },
    },
  },
}
