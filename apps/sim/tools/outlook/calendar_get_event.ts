import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildEventUrl, CALENDAR_RETRY, flattenGraphEvent } from '@/tools/outlook/calendar-utils'
import type {
  GraphEvent,
  OutlookCalendarGetEventParams,
  OutlookCalendarGetEventResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_EVENT_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookCalendarGetEventTool: ToolConfig<
  OutlookCalendarGetEventParams,
  OutlookCalendarGetEventResponse
> = {
  id: 'outlook_calendar_get_event',
  name: 'Outlook Get Calendar Event',
  description: 'Get a single Outlook calendar event by ID',
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
      description: 'The ID of the calendar event to retrieve',
    },
  },

  request: {
    url: (params) => buildEventUrl(params.eventId),
    method: 'GET',
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

  transformResponse: async (response: Response) => {
    const data: GraphEvent = await response.json()

    return {
      success: true,
      output: {
        message: `Successfully retrieved event "${data.subject ?? data.id}".`,
        results: flattenGraphEvent(data),
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'The calendar event object',
      properties: OUTLOOK_EVENT_OUTPUT_PROPERTIES,
    },
  },
}
