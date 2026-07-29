import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildAllDayRange,
  buildEventUrl,
  buildGraphEventDateTime,
  CALENDAR_RETRY,
  flattenGraphEvent,
  isDateOnly,
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
      description:
        'New start time (ISO 8601). A date-only value (2025-06-03) converts the event to all-day.',
    },
    endDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New end time (ISO 8601). A date-only value (2025-06-04) converts the event to all-day.',
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
      description:
        'Whether the event lasts the entire day. Setting this true requires also sending startDateTime, since Graph needs midnight bounds.',
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
    url: (params) => buildEventUrl(params.eventId),
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

      const providedBounds = [params.startDateTime, params.endDateTime].filter(Boolean)
      const explicitAllDay = params.isAllDay !== undefined && toBool(params.isAllDay)
      // Promote implicitly only when BOTH bounds are date-only (matching
      // calendar_create_event). A *single* date-only bound is ambiguous — it could mean
      // "convert to all-day" or "just move the start" — and a PATCH cannot read the
      // event's existing bounds to tell. Deriving the missing side would silently collapse
      // a timed or multi-day event into a one-day all-day event, so a lone date-only bound
      // stays on the timed path and leaves the other side untouched.
      const bothBoundsDateOnly = isDateOnly(params.startDateTime) && isDateOnly(params.endDateTime)
      const settingAllDay = explicitAllDay || bothBoundsDateOnly

      if (params.subject !== undefined) {
        event.subject = params.subject
      }

      if (settingAllDay) {
        // Graph requires an all-day event's start and end to both be midnight in the same
        // zone, so flipping isAllDay on without bounds would 400 against whatever timed
        // start/end the event already has. Fail with an actionable message instead.
        if (providedBounds.length === 0) {
          throw new Error(
            'Converting an event to all-day requires startDateTime (and preferably endDateTime): Microsoft Graph requires all-day events to have midnight start and end bounds, which cannot be derived from a partial update.'
          )
        }
        // Normalize both bounds together. The single-bound fallback only applies when the
        // caller set isAllDay explicitly — implicit promotion requires both bounds — so
        // deriving the missing side follows stated intent rather than guessing at it.
        const start = params.startDateTime || params.endDateTime!
        const end = params.endDateTime || params.startDateTime!
        const range = buildAllDayRange(start, end, params.timeZone)
        event.start = range.start
        event.end = range.end
      } else {
        if (params.startDateTime) {
          event.start = buildGraphEventDateTime(params.startDateTime, params.timeZone)
        }
        if (params.endDateTime) {
          event.end = buildGraphEventDateTime(params.endDateTime, params.timeZone)
        }
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

      if (settingAllDay) {
        event.isAllDay = true
      } else if (params.isAllDay !== undefined) {
        event.isAllDay = toBool(params.isAllDay)
      }

      if (params.isOnlineMeeting !== undefined) {
        // See calendar_create_event: isOnlineMeeting alone initializes `onlineMeeting`, and
        // pinning a provider would break mailboxes that disallow it. Note Graph ignores
        // further changes once a meeting has been made online.
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
