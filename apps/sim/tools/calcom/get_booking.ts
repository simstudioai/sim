import type { CalcomGetBookingParams, CalcomGetBookingResponse } from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const getBookingTool: ToolConfig<CalcomGetBookingParams, CalcomGetBookingResponse> = {
  id: 'calcom_get_booking',
  name: 'Cal.com Get Booking',
  description: 'Get details of a specific booking by its UID',
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
      description: 'Unique identifier (UID) of the booking',
    },
  },

  request: {
    url: (params: CalcomGetBookingParams) => {
      return `https://api.cal.com/v2/bookings/${encodeURIComponent(params.bookingUid)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
    }),
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
      description: 'Booking details',
      properties: {
        id: BOOKING_DATA_OUTPUT_PROPERTIES.id,
        uid: BOOKING_DATA_OUTPUT_PROPERTIES.uid,
        title: BOOKING_DATA_OUTPUT_PROPERTIES.title,
        description: BOOKING_DATA_OUTPUT_PROPERTIES.description,
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
        rating: BOOKING_DATA_OUTPUT_PROPERTIES.rating,
        icsUid: BOOKING_DATA_OUTPUT_PROPERTIES.icsUid,
        cancellationReason: BOOKING_DATA_OUTPUT_PROPERTIES.cancellationReason,
        reschedulingReason: BOOKING_DATA_OUTPUT_PROPERTIES.reschedulingReason,
        rescheduledFromUid: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledFromUid,
        rescheduledToUid: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledToUid,
        cancelledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.cancelledByEmail,
        rescheduledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledByEmail,
        createdAt: BOOKING_DATA_OUTPUT_PROPERTIES.createdAt,
        updatedAt: BOOKING_DATA_OUTPUT_PROPERTIES.updatedAt,
      },
    },
  },
}
