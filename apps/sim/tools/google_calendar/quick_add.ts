import type { ToolConfig } from '../types'
import {
  CALENDAR_API_BASE,
  type GoogleCalendarQuickAddParams,
  type GoogleCalendarQuickAddResponse,
} from './types'

export const quickAddTool: ToolConfig<
  GoogleCalendarQuickAddParams,
  GoogleCalendarQuickAddResponse
> = {
  id: 'google_calendar_quick_add',
  name: 'Google Calendar Quick Add',
  description: 'Create events from natural language text',
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
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural language text describing the event (e.g., "Meeting with John tomorrow at 3pm")',
    },
    attendees: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of attendee email addresses (comma-separated string also accepted)',
    },
    sendUpdates: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'How to send updates to attendees: all, externalOnly, or none',
    },
  },

  request: {
    url: (params: GoogleCalendarQuickAddParams) => {
      const calendarId = params.calendarId || 'primary'
      const queryParams = new URLSearchParams()

      queryParams.append('text', params.text)

      if (params.sendUpdates !== undefined) {
        queryParams.append('sendUpdates', params.sendUpdates)
      }

      return `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?${queryParams.toString()}`
    },
    method: 'POST',
    headers: (params: GoogleCalendarQuickAddParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create calendar event from text')
    }

    // Handle attendees if provided
    let finalEventData = data
    if (params?.attendees) {
      let attendeeList: string[] = []
      const attendees = params.attendees as string | string[]

      if (Array.isArray(attendees)) {
        attendeeList = attendees.filter((email: string) => email && email.trim().length > 0)
      } else if (typeof attendees === 'string' && attendees.trim().length > 0) {
        // Convert comma-separated string to array
        attendeeList = attendees
          .split(',')
          .map((email: string) => email.trim())
          .filter((email: string) => email.length > 0)
      }

      if (attendeeList.length > 0) {
        try {
          // Update the event with attendees
          const calendarId = params.calendarId || 'primary'
          const eventId = data.id

          // Prepare update data
          const updateData = {
            attendees: attendeeList.map((email: string) => ({ email })),
          }

          // Build update URL with sendUpdates if specified
          const updateQueryParams = new URLSearchParams()
          if (params.sendUpdates !== undefined) {
            updateQueryParams.append('sendUpdates', params.sendUpdates)
          }

          const updateUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}${updateQueryParams.toString() ? `?${updateQueryParams.toString()}` : ''}`

          // Make the update request
          const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${params.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          })

          if (updateResponse.ok) {
            finalEventData = await updateResponse.json()
          } else {
            // If update fails, we still return the original event but log the error
            console.warn(
              'Failed to add attendees to quick-added event:',
              await updateResponse.text()
            )
          }
        } catch (error) {
          // If attendee update fails, we still return the original event
          console.warn('Error adding attendees to quick-added event:', error)
        }
      }
    }

    return {
      success: true,
      output: {
        content: `Event "${finalEventData?.summary || 'Untitled'}" created successfully ${finalEventData?.attendees?.length ? ` with ${finalEventData.attendees.length} attendee(s)` : ''}`,
        metadata: {
          id: finalEventData.id,
          htmlLink: finalEventData.htmlLink,
          status: finalEventData.status,
          summary: finalEventData.summary,
          description: finalEventData.description,
          location: finalEventData.location,
          start: finalEventData.start,
          end: finalEventData.end,
          attendees: finalEventData.attendees,
          creator: finalEventData.creator,
          organizer: finalEventData.organizer,
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
      if (error.error.message.includes('parse')) {
        return 'Could not parse the natural language text. Please try a different format.'
      }
      return error.error.message
    }
    return error.message || 'An unexpected error occurred while creating the calendar event'
  },
}
