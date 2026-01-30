import type { CalcomCancelBookingParams, CalcomCancelBookingResponse } from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const cancelBookingTool: ToolConfig<CalcomCancelBookingParams, CalcomCancelBookingResponse> =
  {
    id: 'calcom_cancel_booking',
    name: 'Cal.com Cancel Booking',
    description: 'Cancel an existing booking',
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
        description: 'Unique identifier (UID) of the booking to cancel',
      },
      cancellationReason: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Reason for cancelling the booking',
      },
    },

    request: {
      url: (params: CalcomCancelBookingParams) => {
        return `https://api.cal.com/v2/bookings/${encodeURIComponent(params.bookingUid)}/cancel`
      },
      method: 'POST',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        'cal-api-version': '2024-08-13',
      }),
      body: (params: CalcomCancelBookingParams) => {
        const body: Record<string, unknown> = {}

        if (params.cancellationReason) {
          body.cancellationReason = params.cancellationReason
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
        description: 'Cancelled booking details',
        properties: {
          id: BOOKING_DATA_OUTPUT_PROPERTIES.id,
          uid: BOOKING_DATA_OUTPUT_PROPERTIES.uid,
          title: BOOKING_DATA_OUTPUT_PROPERTIES.title,
          status: {
            type: 'string',
            description: 'Booking status (should be cancelled)',
          },
          cancellationReason: BOOKING_DATA_OUTPUT_PROPERTIES.cancellationReason,
          cancelledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.cancelledByEmail,
          start: BOOKING_DATA_OUTPUT_PROPERTIES.start,
          end: BOOKING_DATA_OUTPUT_PROPERTIES.end,
          duration: BOOKING_DATA_OUTPUT_PROPERTIES.duration,
          eventTypeId: BOOKING_DATA_OUTPUT_PROPERTIES.eventTypeId,
          eventType: EVENT_TYPE_OUTPUT,
          location: BOOKING_DATA_OUTPUT_PROPERTIES.location,
          attendees: ATTENDEES_OUTPUT,
          hosts: HOSTS_OUTPUT,
          metadata: BOOKING_DATA_OUTPUT_PROPERTIES.metadata,
          createdAt: BOOKING_DATA_OUTPUT_PROPERTIES.createdAt,
        },
      },
    },
  }
