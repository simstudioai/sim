import {
  CALENDAR_API_BASE,
  type CalendarAttendee,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarCreateParams,
  type GoogleCalendarCreateResponse,
  type GoogleCalendarEventRequestBody,
} from '@/tools/google_calendar/types'
import {
  assertRecurringTimeZone,
  buildEventDateTime,
  buildGoogleMeetConferenceData,
  normalizeAttendees,
  normalizeRecurrence,
} from '@/tools/google_calendar/utils'
import type { ToolConfig } from '@/tools/types'

export const createTool: ToolConfig<GoogleCalendarCreateParams, GoogleCalendarCreateResponse> = {
  id: 'google_calendar_create',
  name: 'Google Calendar Create Event',
  description: 'Create a new event in Google Calendar',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-calendar',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google Calendar API',
    },
    calendarId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Google Calendar ID (e.g., primary or calendar@group.calendar.google.com)',
    },
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event title/summary',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event description',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event location',
    },
    startDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Start time. Use a datetime with timezone offset (2025-06-03T10:00:00-08:00) or a date (2025-06-03) for an all-day event',
    },
    endDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'End time. Use a datetime with timezone offset (2025-06-03T11:00:00-08:00) or a date (2025-06-04) for an all-day event',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'IANA time zone (e.g., America/Los_Angeles). Used as-is when provided. For recurring events a time zone is required to expand the recurrence correctly; for one-off events it is only needed when the datetime omits a UTC offset (a naive datetime defaults to America/Los_Angeles).',
    },
    attendees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of attendee email addresses',
    },
    recurrence: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Recurrence rule(s) in RFC 5545 format (e.g., RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR). Separate multiple rules with newlines.',
    },
    addGoogleMeet: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attach a Google Meet video conference link to the event',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarCreateParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }
      if (params.addGoogleMeet) {
        queryParams.append('conferenceDataVersion', '1')
      }

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events${queryString ? `?${queryString}` : ''}`
    },
    method: 'POST',
    headers: (params: GoogleCalendarCreateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarCreateParams): GoogleCalendarEventRequestBody => {
      const recurrence = normalizeRecurrence(params.recurrence)
      const isRecurring = recurrence.length > 0

      if (isRecurring) {
        assertRecurringTimeZone([params.startDateTime, params.endDateTime], params.timeZone)
      }

      const eventData: GoogleCalendarEventRequestBody = {
        summary: params.summary,
        start: buildEventDateTime(params.startDateTime, params.timeZone),
        end: buildEventDateTime(params.endDateTime, params.timeZone),
      }

      if (params.description) {
        eventData.description = params.description
      }

      if (params.location) {
        eventData.location = params.location
      }

      const attendees = normalizeAttendees(params.attendees)
      if (attendees.length > 0) {
        eventData.attendees = attendees
      }

      if (isRecurring) {
        eventData.recurrence = recurrence
      }

      if (params.addGoogleMeet) {
        eventData.conferenceData = buildGoogleMeetConferenceData()
      }

      return eventData
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" created successfully`,
        metadata: {
          id: data.id,
          htmlLink: data.htmlLink,
          hangoutLink: data.hangoutLink,
          status: data.status,
          summary: data.summary,
          description: data.description,
          location: data.location,
          recurrence: data.recurrence,
          start: data.start,
          end: data.end,
          attendees: data.attendees,
          creator: data.creator,
          organizer: data.organizer,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Event creation confirmation message' },
    metadata: {
      type: 'json',
      description: 'Created event metadata including ID, status, Meet link, and details',
    },
  },
}

interface GoogleCalendarCreateV2Response {
  success: boolean
  output: {
    id: string
    htmlLink: string
    hangoutLink: string | null
    status: string
    summary: string | null
    description: string | null
    location: string | null
    recurrence: string[] | null
    start: GoogleCalendarApiEventResponse['start']
    end: GoogleCalendarApiEventResponse['end']
    attendees: CalendarAttendee[] | null
    creator: GoogleCalendarApiEventResponse['creator'] | null
    organizer: GoogleCalendarApiEventResponse['organizer'] | null
  }
}

export const createV2Tool: ToolConfig<GoogleCalendarCreateParams, GoogleCalendarCreateV2Response> =
  {
    id: 'google_calendar_create_v2',
    name: 'Google Calendar Create Event',
    description: 'Create a new event in Google Calendar. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: createTool.oauth,
    params: createTool.params,
    request: createTool.request,
    transformResponse: async (response: Response) => {
      const data: GoogleCalendarApiEventResponse = await response.json()

      return {
        success: true,
        output: {
          id: data.id,
          htmlLink: data.htmlLink,
          hangoutLink: data.hangoutLink ?? null,
          status: data.status,
          summary: data.summary ?? null,
          description: data.description ?? null,
          location: data.location ?? null,
          recurrence: data.recurrence ?? null,
          start: data.start,
          end: data.end,
          attendees: data.attendees ?? null,
          creator: data.creator ?? null,
          organizer: data.organizer ?? null,
        },
      }
    },
    outputs: {
      id: { type: 'string', description: 'Event ID' },
      htmlLink: { type: 'string', description: 'Event link' },
      hangoutLink: { type: 'string', description: 'Google Meet link', optional: true },
      status: { type: 'string', description: 'Event status' },
      summary: { type: 'string', description: 'Event title', optional: true },
      description: { type: 'string', description: 'Event description', optional: true },
      location: { type: 'string', description: 'Event location', optional: true },
      recurrence: { type: 'json', description: 'Recurrence rules', optional: true },
      start: { type: 'json', description: 'Event start' },
      end: { type: 'json', description: 'Event end' },
      attendees: { type: 'json', description: 'Event attendees', optional: true },
      creator: { type: 'json', description: 'Event creator', optional: true },
      organizer: { type: 'json', description: 'Event organizer', optional: true },
    },
  }
