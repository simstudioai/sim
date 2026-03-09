import type { CalcomConfirmBookingParams, CalcomConfirmBookingResponse } from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const confirmBookingTool: ToolConfig<
  CalcomConfirmBookingParams,
  CalcomConfirmBookingResponse
> = {
  id: 'calcom_confirm_booking',
  name: 'Cal.com Confirm Booking',
  description: 'Confirm a pending booking that requires confirmation',
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
      description: 'Unique identifier (UID) of the booking to confirm',
    },
  },

  request: {
    url: (params: CalcomConfirmBookingParams) => {
      return `https://api.cal.com/v2/bookings/${encodeURIComponent(params.bookingUid)}/confirm`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
    }),
    body: () => {
      return {}
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
      description: 'Confirmed booking details',
      properties: {
        id: BOOKING_DATA_OUTPUT_PROPERTIES.id,
        uid: BOOKING_DATA_OUTPUT_PROPERTIES.uid,
        title: BOOKING_DATA_OUTPUT_PROPERTIES.title,
        status: {
          type: 'string',
          description: 'Booking status (should be accepted/confirmed)',
        },
        start: BOOKING_DATA_OUTPUT_PROPERTIES.start,
        end: BOOKING_DATA_OUTPUT_PROPERTIES.end,
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
