import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarInviteParams,
  type GoogleCalendarInviteResponse,
} from './types'

export const inviteTool: ToolConfig<GoogleCalendarInviteParams, GoogleCalendarInviteResponse> = {
  id: 'google_calendar_invite',
  name: 'Google Calendar Invite Attendees',
  description: 'Invite attendees to an existing Google Calendar event',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-calendar',
    additionalScopes: ['https://www.googleapis.com/auth/calendar'],
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
      visibility: 'user-only',
      description: 'Calendar ID (defaults to primary)',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Event ID to invite attendees to',
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
      description: 'How to send updates to attendees: all, externalOnly, or none',
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
      const calendarId = params.calendarId || 'primary'
      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params.eventId)}`
    },
    method: 'GET',
    headers: (params: GoogleCalendarInviteParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const existingEvent = await response.json()

    if (!response.ok) {
      throw new Error(existingEvent.error?.message || 'Failed to fetch existing event')
    }

    // Validate required fields exist
    if (!existingEvent.start || !existingEvent.end || !existingEvent.summary) {
      throw new Error('Existing event is missing required fields (start, end, or summary)')
    }

    // Process new attendees - handle both string and array formats
    let newAttendeeList: string[] = []

    if (params?.attendees) {
      if (Array.isArray(params.attendees)) {
        // Already an array from block processing
        newAttendeeList = params.attendees.filter(
          (email: string) => email && email.trim().length > 0
        )
      } else if (
        typeof (params.attendees as any) === 'string' &&
        (params.attendees as any).trim().length > 0
      ) {
        // Fallback: process comma-separated string if block didn't convert it
        newAttendeeList = (params.attendees as any)
          .split(',')
          .map((email: string) => email.trim())
          .filter((email: string) => email.length > 0)
      }
    }

    // Calculate final attendees list
    const existingAttendees = existingEvent.attendees || []
    let finalAttendees: Array<any> = []

    // Handle replaceExisting properly - check for both boolean true and string "true"
    const shouldReplace =
      params?.replaceExisting === true || (params?.replaceExisting as any) === 'true'

    if (shouldReplace) {
      // Replace all attendees with just the new ones
      finalAttendees = newAttendeeList.map((email: string) => ({
        email,
        responseStatus: 'needsAction',
      }))
    } else {
      // Add to existing attendees (preserve all existing ones)

      // Start with ALL existing attendees - preserve them completely
      finalAttendees = [...existingAttendees]

      // Get set of existing emails for duplicate checking (case-insensitive)
      const existingEmails = new Set(
        existingAttendees.map((attendee: any) => attendee.email?.toLowerCase() || '')
      )

      // Add only new attendees that don't already exist
      for (const newEmail of newAttendeeList) {
        const emailLower = newEmail.toLowerCase()
        if (!existingEmails.has(emailLower)) {
          finalAttendees.push({
            email: newEmail,
            responseStatus: 'needsAction',
          })
        }
      }
    }

    // Use the complete existing event object and only modify the attendees field
    // This is crucial because the Google Calendar API update method "does not support patch semantics
    // and always updates the entire event resource" according to the documentation
    const updatedEvent = {
      ...existingEvent, // Start with the complete existing event to preserve all fields
      attendees: finalAttendees, // Only modify the attendees field
    }

    // Remove read-only fields that shouldn't be included in updates
    const readOnlyFields = [
      'id',
      'etag',
      'kind',
      'created',
      'updated',
      'htmlLink',
      'iCalUID',
      'sequence',
      'creator',
      'organizer',
    ]
    readOnlyFields.forEach((field) => {
      delete updatedEvent[field]
    })

    // Construct PUT URL with query parameters
    const calendarId = params?.calendarId || 'primary'
    const queryParams = new URLSearchParams()
    if (params?.sendUpdates !== undefined) {
      queryParams.append('sendUpdates', params.sendUpdates)
    }

    const queryString = queryParams.toString()
    const putUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(params?.eventId || '')}${queryString ? `?${queryString}` : ''}`

    // Send PUT request to update the event
    const putResponse = await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${params?.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedEvent),
    })

    // Handle the PUT response
    if (!putResponse.ok) {
      const errorData = await putResponse.json()
      throw new Error(errorData.error?.message || 'Failed to invite attendees to calendar event')
    }

    const data = await putResponse.json()
    const totalAttendees = data.attendees?.length || 0

    // Calculate how many new attendees were actually added
    let newAttendeesAdded = 0

    if (shouldReplace) {
      newAttendeesAdded = newAttendeeList.length
    } else {
      // Count how many of the new emails weren't already in the existing list
      const existingEmails = new Set(
        existingAttendees.map((attendee: any) => attendee.email?.toLowerCase() || '')
      )
      newAttendeesAdded = newAttendeeList.filter(
        (email) => !existingEmails.has(email.toLowerCase())
      ).length
    }

    // Improved messaging about email delivery
    let baseMessage: string
    if (shouldReplace) {
      baseMessage = `Successfully updated event "${data.summary}" with ${totalAttendees} attendee${totalAttendees !== 1 ? 's' : ''}`
    } else {
      if (newAttendeesAdded > 0) {
        baseMessage = `Successfully added ${newAttendeesAdded} new attendee${newAttendeesAdded !== 1 ? 's' : ''} to event "${data.summary}" (total: ${totalAttendees})`
      } else {
        baseMessage = `No new attendees added to event "${data.summary}" - all specified attendees were already invited (total: ${totalAttendees})`
      }
    }

    const emailNote =
      params?.sendUpdates !== 'none'
        ? ` Email invitations are being sent asynchronously - delivery may take a few minutes and depends on recipients' Google Calendar settings.`
        : ` No email notifications will be sent as requested.`

    const content = baseMessage + emailNote

    return {
      success: true,
      output: {
        content,
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

  transformError: (error) => {
    if (error.error?.message) {
      if (error.error.message.includes('invalid authentication credentials')) {
        return 'Invalid or expired access token. Please reauthenticate.'
      }
      if (error.error.message.includes('quota')) {
        return 'Google Calendar API quota exceeded. Please try again later.'
      }
      if (error.error.message.includes('Calendar not found')) {
        return 'Calendar not found. Please check the calendar ID.'
      }
      if (
        error.error.message.includes('Event not found') ||
        error.error.message.includes('Not Found')
      ) {
        return 'Event not found. Please check the event ID.'
      }
      if (error.error.message.includes('Failed to fetch existing event')) {
        return `Unable to retrieve existing event details: ${error.error.message}`
      }
      return error.error.message
    }
    return (
      error.message || 'An unexpected error occurred while inviting attendees to the calendar event'
    )
  },
}
