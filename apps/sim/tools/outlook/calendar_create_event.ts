import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildAllDayRange,
  buildCalendarScopedUrl,
  buildGraphEventDateTime,
  CALENDAR_RETRY,
  flattenGraphEvent,
  isDateOnly,
  normalizeAttendees,
} from '@/tools/outlook/calendar-utils'
import type {
  GraphEvent,
  OutlookCalendarCreateEventParams,
  OutlookCalendarCreateEventResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_EVENT_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

/** Agent calls may deliver booleans as the strings "true"/"false". */
const toBool = (value: unknown): boolean => value === true || value === 'true'

export const outlookCalendarCreateEventTool: ToolConfig<
  OutlookCalendarCreateEventParams,
  OutlookCalendarCreateEventResponse
> = {
  id: 'outlook_calendar_create_event',
  name: 'Outlook Create Calendar Event',
  description: 'Create a new Outlook calendar event',
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
    calendarId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'ID of the calendar to create the event in. Defaults to the mailbox default calendar. Calendars shared by another user are not supported and may return 403.',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event subject/title',
    },
    startDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start time (ISO 8601, e.g. 2025-06-03T10:00:00-08:00). A date-only value (2025-06-03) for both start and end creates an all-day event.',
    },
    endDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End time (ISO 8601, e.g. 2025-06-03T11:00:00-08:00). A date-only value (2025-06-04) for both start and end creates an all-day event.',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'IANA or Windows time zone name (e.g. America/Los_Angeles). Used for datetimes without a UTC offset. Defaults to UTC.',
    },
    body: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event body content',
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
      description: 'Event location display name',
    },
    attendees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attendee email addresses (comma-separated)',
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
    url: (params) => buildCalendarScopedUrl('events', params.calendarId),
    method: 'POST',
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
      // Date-only bounds carry no time, so they can only mean an all-day event. Without
      // this promotion, `2025-06-03` for both bounds would build a zero-length
      // 00:00->00:00 timed window that Graph rejects, even though the param docs invite
      // date-only input for all-day events.
      const bothBoundsDateOnly = isDateOnly(params.startDateTime) && isDateOnly(params.endDateTime)
      const isAllDay = toBool(params.isAllDay) || bothBoundsDateOnly
      const event: Record<string, unknown> = { subject: params.subject }

      if (isAllDay) {
        // All-day events need midnight bounds with an exclusive end day.
        const range = buildAllDayRange(params.startDateTime, params.endDateTime, params.timeZone)
        event.isAllDay = true
        event.start = range.start
        event.end = range.end
      } else {
        event.start = buildGraphEventDateTime(params.startDateTime, params.timeZone)
        event.end = buildGraphEventDateTime(params.endDateTime, params.timeZone)
      }

      if (params.body) {
        event.body = { contentType: params.contentType || 'text', content: params.body }
      }

      if (params.location) {
        event.location = { displayName: params.location }
      }

      const attendees = normalizeAttendees(params.attendees)
      if (attendees.length > 0) {
        event.attendees = attendees
      }

      if (toBool(params.isOnlineMeeting)) {
        // Setting isOnlineMeeting alone is enough: Graph initializes `onlineMeeting` from
        // it, and `onlineMeetingProvider` is optional. We deliberately do not pin
        // teamsForBusiness, since that value is invalid on mailboxes that don't allow it
        // (see calendar.allowedOnlineMeetingProviders).
        // https://learn.microsoft.com/en-us/graph/api/resources/event
        event.isOnlineMeeting = true
      }

      return event
    },
  },

  transformResponse: async (response: Response) => {
    const data: GraphEvent = await response.json()

    return {
      success: true,
      output: {
        message: `Successfully created event "${data.subject ?? data.id}".`,
        results: flattenGraphEvent(data),
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'The created calendar event object',
      properties: OUTLOOK_EVENT_OUTPUT_PROPERTIES,
    },
  },
}
