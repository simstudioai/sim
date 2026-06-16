import {
  CALENDAR_API_BASE,
  type CalendarAttendee,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarEventRequestBody,
  type GoogleCalendarUpdateParams,
  type GoogleCalendarUpdateResponse,
} from '@/tools/google_calendar/types'
import {
  assertRecurringTimeZone,
  buildEventDateTime,
  buildGoogleMeetConferenceData,
  normalizeAttendees,
  normalizeRecurrence,
} from '@/tools/google_calendar/utils'
import type { ToolConfig } from '@/tools/types'

type EventPatchBody = Partial<GoogleCalendarEventRequestBody>

export const updateTool: ToolConfig<GoogleCalendarUpdateParams, GoogleCalendarUpdateResponse> = {
  id: 'google_calendar_update',
  name: 'Google Calendar Update Event',
  description: 'Update an existing event in Google Calendar',
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
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Google Calendar event ID to update',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event title/summary',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event description',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New event location',
    },
    startDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New start time. Use a datetime with timezone offset (2025-06-03T10:00:00-08:00) or a date (2025-06-03) for an all-day event',
    },
    endDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New end time. Use a datetime with timezone offset (2025-06-03T11:00:00-08:00) or a date (2025-06-04) for an all-day event',
    },
    timeZone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'IANA time zone (e.g., America/Los_Angeles) applied to the start/end times provided in this update. Provide a new start and/or end time to change the time zone; a time zone on its own is not applied. Required for recurring events to expand the recurrence correctly.',
    },
    attendees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of attendee email addresses. When one or more emails are provided, they replace the existing attendee list. Leaving this empty keeps the current attendees unchanged (it does not clear them).',
    },
    recurrence: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Recurrence rule(s) in RFC 5545 format (e.g., RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR). Separate multiple rules with newlines. When provided, replaces the event's recurrence; leaving it empty keeps the existing recurrence unchanged. Requires a timeZone for timed events.",
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
    url: (params: GoogleCalendarUpdateParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }
      if (params.addGoogleMeet) {
        queryParams.append('conferenceDataVersion', '1')
      }

      const queryString = queryParams.toString()
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}${queryString ? `?${queryString}` : ''}`
    },
    method: 'PATCH',
    headers: (params: GoogleCalendarUpdateParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleCalendarUpdateParams): EventPatchBody => {
      const updateData: EventPatchBody = {}
      const recurrence = normalizeRecurrence(params.recurrence)
      const isRecurring = recurrence.length > 0

      if (isRecurring) {
        assertRecurringTimeZone([params.startDateTime, params.endDateTime], params.timeZone)
      }

      if (params.summary !== undefined) {
        updateData.summary = params.summary
      }

      if (params.description !== undefined) {
        updateData.description = params.description
      }

      if (params.location !== undefined) {
        updateData.location = params.location
      }

      if (params.startDateTime !== undefined) {
        updateData.start = buildEventDateTime(params.startDateTime, params.timeZone)
      }

      if (params.endDateTime !== undefined) {
        updateData.end = buildEventDateTime(params.endDateTime, params.timeZone)
      }

      const attendees = normalizeAttendees(params.attendees)
      if (attendees.length > 0) {
        updateData.attendees = attendees
      }

      if (isRecurring) {
        updateData.recurrence = recurrence
      }

      if (params.addGoogleMeet) {
        updateData.conferenceData = buildGoogleMeetConferenceData()
      }

      return updateData
    },
  },

  transformResponse: async (response: Response) => {
    const data: GoogleCalendarApiEventResponse = await response.json()

    return {
      success: true,
      output: {
        content: `Event "${data.summary}" updated successfully`,
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
    content: { type: 'string', description: 'Event update confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated event metadata including ID, status, Meet link, and details',
    },
  },
}

interface GoogleCalendarUpdateV2Response {
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

export const updateV2Tool: ToolConfig<GoogleCalendarUpdateParams, GoogleCalendarUpdateV2Response> =
  {
    id: 'google_calendar_update_v2',
    name: 'Google Calendar Update Event',
    description: 'Update an existing event in Google Calendar. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: updateTool.oauth,
    params: updateTool.params,
    request: updateTool.request,
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
