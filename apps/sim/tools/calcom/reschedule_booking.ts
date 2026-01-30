import type {
  CalcomRescheduleBookingParams,
  CalcomRescheduleBookingResponse,
} from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const rescheduleBookingTool: ToolConfig<
  CalcomRescheduleBookingParams,
  CalcomRescheduleBookingResponse
> = {
  id: 'calcom_reschedule_booking',
  name: 'Cal.com Reschedule Booking',
  description: 'Reschedule an existing booking to a new time',
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
    bookingUid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier (UID) of the booking to reschedule',
    },
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New start time in UTC ISO 8601 format (e.g., 2024-01-15T09:00:00Z)',
    },
    reschedulingReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reason for rescheduling the booking',
    },
  },

  request: {
    url: (params: CalcomRescheduleBookingParams) => {
      return `https://api.cal.com/v2/bookings/${encodeURIComponent(params.bookingUid)}/reschedule`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
    }),
    body: (params: CalcomRescheduleBookingParams) => {
      const body: Record<string, unknown> = {
        start: params.start,
      }

      if (params.reschedulingReason) {
        body.reschedulingReason = params.reschedulingReason
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

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
      description: 'Rescheduled booking details',
      properties: {
        id: BOOKING_DATA_OUTPUT_PROPERTIES.id,
        uid: {
          type: 'string',
          description: 'Unique identifier for the new booking',
        },
        title: BOOKING_DATA_OUTPUT_PROPERTIES.title,
        status: BOOKING_DATA_OUTPUT_PROPERTIES.status,
        reschedulingReason: BOOKING_DATA_OUTPUT_PROPERTIES.reschedulingReason,
        rescheduledFromUid: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledFromUid,
        rescheduledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledByEmail,
        start: {
          type: 'string',
          description: 'New start time in ISO 8601 format',
        },
        end: {
          type: 'string',
          description: 'New end time in ISO 8601 format',
        },
        duration: BOOKING_DATA_OUTPUT_PROPERTIES.duration,
        eventTypeId: BOOKING_DATA_OUTPUT_PROPERTIES.eventTypeId,
        eventType: EVENT_TYPE_OUTPUT,
        meetingUrl: BOOKING_DATA_OUTPUT_PROPERTIES.meetingUrl,
        location: BOOKING_DATA_OUTPUT_PROPERTIES.location,
        attendees: ATTENDEES_OUTPUT,
        hosts: HOSTS_OUTPUT,
        guests: BOOKING_DATA_OUTPUT_PROPERTIES.guests,
        metadata: BOOKING_DATA_OUTPUT_PROPERTIES.metadata,
        icsUid: BOOKING_DATA_OUTPUT_PROPERTIES.icsUid,
        createdAt: BOOKING_DATA_OUTPUT_PROPERTIES.createdAt,
      },
    },
  },
}
