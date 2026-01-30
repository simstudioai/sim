import type { CalcomCreateBookingParams, CalcomCreateBookingResponse } from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const createBookingTool: ToolConfig<CalcomCreateBookingParams, CalcomCreateBookingResponse> =
  {
    id: 'calcom_create_booking',
    name: 'Cal.com Create Booking',
    description: 'Create a new booking on Cal.com',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'calcom',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'Cal.com OAuth access token',
      },
      eventTypeId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'The ID of the event type to book',
      },
      start: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Start time in UTC ISO 8601 format (e.g., 2024-01-15T09:00:00Z)',
      },
      attendee: {
        type: 'object',
        required: true,
        visibility: 'hidden',
        description:
          'Attendee information object with name, email, timeZone, and optional phoneNumber (constructed from individual attendee fields)',
      },
      guests: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'Array of guest email addresses',
        items: {
          type: 'string',
          description: 'Guest email address',
        },
      },
      lengthInMinutes: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Duration of the booking in minutes (overrides event type default)',
      },
      metadata: {
        type: 'object',
        required: false,
        visibility: 'user-or-llm',
        description: 'Custom metadata to attach to the booking',
      },
    },

    request: {
      url: 'https://api.cal.com/v2/bookings',
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
      }),
      body: (params: CalcomCreateBookingParams) => {
        const body: Record<string, unknown> = {
          eventTypeId: params.eventTypeId,
          start: params.start,
          attendee: params.attendee,
        }

        if (params.guests && params.guests.length > 0) {
          body.guests = params.guests
        }

        if (params.lengthInMinutes !== undefined) {
          body.lengthInMinutes = params.lengthInMinutes
        }

        if (params.metadata) {
          body.metadata = params.metadata
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: data,
          error:
            data.error?.message || data.message || `Request failed with status ${response.status}`,
        }
      }

      return {
        success: true,
        output: data,
      }
    },

    outputs: {
      status: {
        type: 'string',
        description: 'Response status',
      },
      data: {
        type: 'object',
        description: 'Created booking details',
        properties: {
          id: BOOKING_DATA_OUTPUT_PROPERTIES.id,
          uid: BOOKING_DATA_OUTPUT_PROPERTIES.uid,
          title: BOOKING_DATA_OUTPUT_PROPERTIES.title,
          status: BOOKING_DATA_OUTPUT_PROPERTIES.status,
          start: BOOKING_DATA_OUTPUT_PROPERTIES.start,
          end: BOOKING_DATA_OUTPUT_PROPERTIES.end,
          duration: BOOKING_DATA_OUTPUT_PROPERTIES.duration,
          eventTypeId: BOOKING_DATA_OUTPUT_PROPERTIES.eventTypeId,
          eventType: EVENT_TYPE_OUTPUT,
          meetingUrl: BOOKING_DATA_OUTPUT_PROPERTIES.meetingUrl,
          location: BOOKING_DATA_OUTPUT_PROPERTIES.location,
          absentHost: BOOKING_DATA_OUTPUT_PROPERTIES.absentHost,
          attendees: ATTENDEES_OUTPUT,
          hosts: HOSTS_OUTPUT,
          guests: BOOKING_DATA_OUTPUT_PROPERTIES.guests,
          bookingFieldsResponses: BOOKING_DATA_OUTPUT_PROPERTIES.bookingFieldsResponses,
          metadata: BOOKING_DATA_OUTPUT_PROPERTIES.metadata,
          icsUid: BOOKING_DATA_OUTPUT_PROPERTIES.icsUid,
          createdAt: BOOKING_DATA_OUTPUT_PROPERTIES.createdAt,
        },
      },
    },
  }
