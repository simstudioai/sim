import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildGraphEventDateTime,
  CALENDAR_RETRY,
  flattenGraphEvent,
  normalizeAttendees,
} from '@/tools/outlook/calendar-utils'
import type {
  GraphEvent,
  OutlookCalendarUpdateEventParams,
  OutlookCalendarUpdateEventResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_EVENT_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

/** Agent calls may deliver booleans as the strings "true"/"false". */
const toBool = (value: unknown): boolean => value === true || value === 'true'

export const outlookCalendarUpdateEventTool: ToolConfig<
  OutlookCalendarUpdateEventParams,
  OutlookCalendarUpdateEventResponse
> = {
  id: 'outlook_calendar_update_event',
  name: 'Outlook Update Calendar Event',
  description: 'Update an existing Outlook calendar event',
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
      description: 'The ID of the calendar event to update',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event subject/title',
    },
    startDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start time (ISO 8601) or a date (2025-06-03) for an all-day event',
    },
    endDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end time (ISO 8601) or a date (2025-06-04) for an all-day event',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'IANA or Windows time zone name applied to updated datetimes without a UTC offset. Defaults to UTC.',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event body content',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type for the event body (text or html)',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event location display name',
    },
    attendees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement attendee email addresses (comma-separated)',
    },
    isAllDay: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the event lasts the entire day',
    },
    isOnlineMeeting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Attach an online meeting to the event. Uses the mailbox default provider (Teams on work/school accounts); personal accounts have no supported online-meeting provider.',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(params.eventId.trim())}`,
    method: 'PATCH',
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
    body: (params) => {
      // PATCH is a partial update: only include fields the caller actually provided.
      const event: Record<string, unknown> = {}

      if (params.subject !== undefined) {
        event.subject = params.subject
      }

      if (params.startDateTime) {
        event.start = buildGraphEventDateTime(params.startDateTime, params.timeZone)
      }

      if (params.endDateTime) {
        event.end = buildGraphEventDateTime(params.endDateTime, params.timeZone)
      }

      if (params.body !== undefined) {
        event.body = { contentType: params.contentType || 'text', content: params.body }
      }

      if (params.location !== undefined) {
        event.location = { displayName: params.location }
      }

      if (params.attendees !== undefined) {
        event.attendees = normalizeAttendees(params.attendees)
      }

      if (params.isAllDay !== undefined) {
        event.isAllDay = toBool(params.isAllDay)
      }

      if (params.isOnlineMeeting !== undefined) {
        // Let Graph use the mailbox's default online-meeting provider (Teams on
        // work/school accounts) rather than hardcoding teamsForBusiness. Personal
        // accounts have no supported provider (Skype consumer was retired in 2025).
        event.isOnlineMeeting = toBool(params.isOnlineMeeting)
      }

      return event
    },
  },

  transformResponse: async (response: Response) => {
    const data: GraphEvent = await response.json()

    return {
      success: true,
      output: {
        message: `Successfully updated event "${data.subject ?? data.id}".`,
        results: flattenGraphEvent(data),
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'The updated calendar event object',
      properties: OUTLOOK_EVENT_OUTPUT_PROPERTIES,
    },
  },
}
