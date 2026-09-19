import {
  CALENDAR_API_BASE,
  type CalendarAttendee,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarRespondParams,
  type GoogleCalendarRespondResponse,
} from '@/tools/google_calendar/types'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

const RESPONSE_STATUSES = ['accepted', 'declined', 'tentative'] as const

interface RespondResult {
  data: GoogleCalendarApiEventResponse
  responseStatus: string
  comment: string | null
}

/**
 * Set the calendar owner's RSVP on an event. The event is read first to find the attendee
 * entry flagged `self`, then patched with `attendeesOmitted: true` and only that entry, which
 * tells Google to update just this participant's response and leave every other guest intact.
 * Passing a recurring-event instance ID changes the response for that occurrence only.
 * The execution signal is forwarded so a canceled run never writes the RSVP.
 */
async function respondToEvent(
  response: Response,
  params: GoogleCalendarRespondParams | undefined,
  signal: AbortSignal | undefined
): Promise<RespondResult> {
  const existingEvent: GoogleCalendarApiEventResponse = await response.json()

  const responseStatus = params?.responseStatus?.trim()
  if (
    !responseStatus ||
    !RESPONSE_STATUSES.includes(responseStatus as (typeof RESPONSE_STATUSES)[number])
  ) {
    throw new Error(
      `Invalid response status "${params?.responseStatus ?? ''}". Use accepted, declined, or tentative.`
    )
  }

  const selfAttendee = existingEvent.attendees?.find((attendee) => attendee.self)
  if (!selfAttendee?.email) {
    throw new Error(
      'This calendar is not an attendee of the event, so there is no invitation to respond to'
    )
  }

  const comment = params?.comment?.trim()
  const attendeeUpdate: Pick<CalendarAttendee, 'email' | 'responseStatus' | 'comment'> = {
    email: selfAttendee.email,
    responseStatus,
  }
  if (comment) {
    attendeeUpdate.comment = comment
  }

  const calendarId = params?.calendarId?.trim() || 'primary'
  const queryParams = new URLSearchParams()
  if (params?.sendUpdates) {
    queryParams.append('sendUpdates', params.sendUpdates)
  }
  const queryString = queryParams.toString()
  const patchUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params?.eventId?.trim() ?? '')}${queryString ? `?${queryString}` : ''}`

  signal?.throwIfAborted()
  const patchResponse = await fetch(patchUrl, {
    method: 'PATCH',
    signal,
    headers: {
      Authorization: `Bearer ${params?.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attendeesOmitted: true, attendees: [attendeeUpdate] }),
  })

  if (!patchResponse.ok) {
    const errorData = await patchResponse.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to respond to calendar event')
  }

  const data: GoogleCalendarApiEventResponse = await patchResponse.json()
  const updatedSelf = data.attendees?.find((attendee) => attendee.self)
  if (updatedSelf?.responseStatus !== responseStatus) {
    throw new Error(
      `Google Calendar did not apply the response: expected "${responseStatus}" but the event shows "${updatedSelf?.responseStatus ?? 'no response'}"`
    )
  }

  if (comment && updatedSelf.comment !== comment) {
    throw new Error(
      `Response set to "${responseStatus}", but Google Calendar did not save the response note`
    )
  }

  return { data, responseStatus, comment: updatedSelf.comment ?? null }
}

export const respondTool: ToolConfig<GoogleCalendarRespondParams, GoogleCalendarRespondResponse> = {
  id: 'google_calendar_respond',
  name: 'Google Calendar Respond to Invitation',
  description:
    'RSVP to a Google Calendar event (accept, decline, or tentative) as the connected account. Only your own response changes; other guests are left untouched.',
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
      description:
        'Google Calendar ID the invitation appears on (e.g., primary or calendar@group.calendar.google.com)',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Google Calendar event ID to respond to. Use a recurring-event instance ID (as returned by List Events or Get Recurring Instances) to respond to a single occurrence; the series ID responds to every occurrence.',
    },
    responseStatus: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your response: accepted, declined, or tentative',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional note to include with your response',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Who to notify about your response: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarRespondParams) => {
      const calendarId = params.calendarId?.trim() || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId.trim())}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarRespondParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params, context?: ToolResponseContext) => {
    const { data, responseStatus } = await respondToEvent(response, params, context?.signal)

    return {
      success: true,
      output: {
        content: `Response to "${data.summary}" set to ${responseStatus}`,
        metadata: {
          id: data.id,
          htmlLink: data.htmlLink,
          status: data.status,
          summary: data.summary,
          description: data.description,
          location: data.location,
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
    content: { type: 'string', description: 'RSVP confirmation message' },
    metadata: {
      type: 'json',
      description: 'Updated event metadata including the attendee list with your response',
    },
  },
}

interface GoogleCalendarRespondV2Response {
  success: boolean
  output: {
    id: string
    htmlLink: string
    status: string
    summary: string | null
    start: GoogleCalendarApiEventResponse['start']
    end: GoogleCalendarApiEventResponse['end']
    responseStatus: string
    comment: string | null
    attendees: CalendarAttendee[] | null
    organizer: GoogleCalendarApiEventResponse['organizer'] | null
  }
}

export const respondV2Tool: ToolConfig<
  GoogleCalendarRespondParams,
  GoogleCalendarRespondV2Response
> = {
  id: 'google_calendar_respond_v2',
  name: 'Google Calendar Respond to Invitation',
  description:
    'RSVP to a Google Calendar event (accept, decline, or tentative) as the connected account. Only your own response changes; other guests are left untouched. Returns API-aligned fields only.',
  version: '2.0.0',
  oauth: respondTool.oauth,
  params: respondTool.params,
  request: respondTool.request,
  transformResponse: async (response: Response, params, context?: ToolResponseContext) => {
    const { data, responseStatus, comment } = await respondToEvent(
      response,
      params,
      context?.signal
    )

    return {
      success: true,
      output: {
        id: data.id,
        htmlLink: data.htmlLink,
        status: data.status,
        summary: data.summary ?? null,
        start: data.start,
        end: data.end,
        responseStatus,
        comment,
        attendees: data.attendees ?? null,
        organizer: data.organizer ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Event ID' },
    htmlLink: { type: 'string', description: 'Event link' },
    status: { type: 'string', description: 'Event status' },
    summary: { type: 'string', description: 'Event title', nullable: true },
    start: { type: 'json', description: 'Event start' },
    end: { type: 'json', description: 'Event end' },
    responseStatus: {
      type: 'string',
      description: 'Your confirmed response (accepted, declined, or tentative)',
    },
    comment: { type: 'string', description: 'Your response comment', nullable: true },
    attendees: { type: 'json', description: 'Event attendees', nullable: true },
    organizer: { type: 'json', description: 'Event organizer', nullable: true },
  },
}
