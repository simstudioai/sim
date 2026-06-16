import {
  CALENDAR_API_BASE,
  type CalendarAttendee,
  type GoogleCalendarApiEventResponse,
  type GoogleCalendarInviteParams,
  type GoogleCalendarInviteResponse,
} from '@/tools/google_calendar/types'
import { normalizeAttendees } from '@/tools/google_calendar/utils'
import type { ToolConfig } from '@/tools/types'

interface InviteResult {
  data: GoogleCalendarApiEventResponse
  totalAttendees: number
  newAttendeesAdded: number
  shouldReplace: boolean
}

/**
 * The Google Calendar update method replaces the entire event resource, so to invite
 * attendees we read the existing event, merge the attendee list, then PUT it back.
 */
async function inviteAttendees(
  response: Response,
  params: GoogleCalendarInviteParams | undefined
): Promise<InviteResult> {
  const existingEvent: GoogleCalendarApiEventResponse = await response.json()

  if (!existingEvent.start || !existingEvent.end || !existingEvent.summary) {
    throw new Error('Existing event is missing required fields (start, end, or summary)')
  }

  const newAttendeeList = normalizeAttendees(params?.attendees).map((attendee) => attendee.email)
  const existingAttendees: CalendarAttendee[] = existingEvent.attendees ?? []
  const shouldReplace =
    params?.replaceExisting === true || String(params?.replaceExisting) === 'true'

  const existingEmails = new Set(
    existingAttendees.map((attendee) => attendee.email?.toLowerCase() ?? '')
  )
  const newAttendeesAdded = shouldReplace
    ? newAttendeeList.length
    : newAttendeeList.filter((email) => !existingEmails.has(email.toLowerCase())).length

  let finalAttendees: CalendarAttendee[]
  if (shouldReplace) {
    finalAttendees = newAttendeeList.map((email) => ({ email, responseStatus: 'needsAction' }))
  } else {
    finalAttendees = [...existingAttendees]
    for (const email of newAttendeeList) {
      if (!existingEmails.has(email.toLowerCase())) {
        finalAttendees.push({ email, responseStatus: 'needsAction' })
      }
    }
  }

  const updatedEvent: Record<string, unknown> = { ...existingEvent, attendees: finalAttendees }
  const readOnlyFields = [
    'id',
    'etag',
    'kind',
    'created',
    'updated',
    'htmlLink',
    'iCalUID',
    'creator',
    'organizer',
  ]
  for (const field of readOnlyFields) {
    delete updatedEvent[field]
  }

  const calendarId = params?.calendarId?.trim() || 'primary'
  const queryParams = new URLSearchParams()
  queryParams.append('sendUpdates', params?.sendUpdates ?? 'all')
  const putUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params?.eventId?.trim() ?? '')}?${queryParams.toString()}`

  const putResponse = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${params?.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updatedEvent),
  })

  if (!putResponse.ok) {
    const errorData = await putResponse.json().catch(() => null)
    throw new Error(errorData?.error?.message || 'Failed to invite attendees to calendar event')
  }

  const data: GoogleCalendarApiEventResponse = await putResponse.json()
  return {
    data,
    totalAttendees: data.attendees?.length ?? 0,
    newAttendeesAdded,
    shouldReplace,
  }
}

export const inviteTool: ToolConfig<GoogleCalendarInviteParams, GoogleCalendarInviteResponse> = {
  id: 'google_calendar_invite',
  name: 'Google Calendar Invite Attendees',
  description: 'Invite attendees to an existing Google Calendar event',
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
      description: 'Google Calendar event ID to invite attendees to',
    },
    attendees: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of attendee email addresses to invite',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none (defaults to all)',
    },
    replaceExisting: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to replace existing attendees or add to them (defaults to false)',
    },
  },

  request: {
    url: (params: GoogleCalendarInviteParams) => {
      const calendarId = params.calendarId?.trim() || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId.trim())}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarInviteParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const { data, totalAttendees, newAttendeesAdded, shouldReplace } = await inviteAttendees(
      response,
      params
    )

    let baseMessage: string
    if (shouldReplace) {
      baseMessage = `Successfully updated event "${data.summary}" with ${totalAttendees} attendee${totalAttendees !== 1 ? 's' : ''}`
    } else if (newAttendeesAdded > 0) {
      baseMessage = `Successfully added ${newAttendeesAdded} new attendee${newAttendeesAdded !== 1 ? 's' : ''} to event "${data.summary}" (total: ${totalAttendees})`
    } else {
      baseMessage = `No new attendees added to event "${data.summary}" - all specified attendees were already invited (total: ${totalAttendees})`
    }

    const emailNote =
      params?.sendUpdates !== 'none'
        ? ' Email invitations are being sent asynchronously - delivery may take a few minutes and depends on recipients’ Google Calendar settings.'
        : ' No email notifications will be sent as requested.'

    return {
      success: true,
      output: {
        content: baseMessage + emailNote,
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
    content: {
      type: 'string',
      description: 'Attendee invitation confirmation message with email delivery status',
    },
    metadata: {
      type: 'json',
      description: 'Updated event metadata including attendee list and details',
    },
  },
}

interface GoogleCalendarInviteV2Response {
  success: boolean
  output: {
    id: string
    htmlLink: string
    status: string
    summary: string | null
    description: string | null
    location: string | null
    start: GoogleCalendarApiEventResponse['start']
    end: GoogleCalendarApiEventResponse['end']
    attendees: CalendarAttendee[] | null
    creator: GoogleCalendarApiEventResponse['creator'] | null
    organizer: GoogleCalendarApiEventResponse['organizer'] | null
  }
}

export const inviteV2Tool: ToolConfig<GoogleCalendarInviteParams, GoogleCalendarInviteV2Response> =
  {
    id: 'google_calendar_invite_v2',
    name: 'Google Calendar Invite Attendees',
    description:
      'Invite attendees to an existing Google Calendar event. Returns API-aligned fields only.',
    version: '2.0.0',
    oauth: inviteTool.oauth,
    params: inviteTool.params,
    request: inviteTool.request,
    transformResponse: async (response: Response, params) => {
      const { data } = await inviteAttendees(response, params)

      return {
        success: true,
        output: {
          id: data.id,
          htmlLink: data.htmlLink,
          status: data.status,
          summary: data.summary ?? null,
          description: data.description ?? null,
          location: data.location ?? null,
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
      status: { type: 'string', description: 'Event status' },
      summary: { type: 'string', description: 'Event title', optional: true },
      description: { type: 'string', description: 'Event description', optional: true },
      location: { type: 'string', description: 'Event location', optional: true },
      start: { type: 'json', description: 'Event start' },
      end: { type: 'json', description: 'Event end' },
      attendees: { type: 'json', description: 'Event attendees', optional: true },
      creator: { type: 'json', description: 'Event creator', optional: true },
      organizer: { type: 'json', description: 'Event organizer', optional: true },
    },
  }
