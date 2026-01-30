import type { CalcomListBookingsParams, CalcomListBookingsResponse } from '@/tools/calcom/types'
import {
  ATTENDEES_OUTPUT,
  BOOKING_DATA_OUTPUT_PROPERTIES,
  EVENT_TYPE_OUTPUT,
  HOSTS_OUTPUT,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const listBookingsTool: ToolConfig<CalcomListBookingsParams, CalcomListBookingsResponse> = {
  id: 'calcom_list_bookings',
  name: 'Cal.com List Bookings',
  description: 'List all bookings with optional status filter',
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
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter bookings by status: upcoming, recurring, past, cancelled, or unconfirmed',
    },
    take: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of bookings to return (pagination limit)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of bookings to skip (pagination offset)',
    },
  },

  request: {
    url: (params: CalcomListBookingsParams) => {
      const baseUrl = 'https://api.cal.com/v2/bookings'
      const queryParams: string[] = []

      if (params.status) {
        queryParams.push(`status=${encodeURIComponent(params.status)}`)
      }

      if (params.take !== undefined) {
        queryParams.push(`take=${params.take}`)
      }

      if (params.skip !== undefined) {
        queryParams.push(`skip=${params.skip}`)
      }

      return queryParams.length > 0 ? `${baseUrl}?${queryParams.join('&')}` : baseUrl
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
      type: 'array',
      description: 'Array of bookings',
      items: {
        type: 'object',
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
          cancelledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.cancelledByEmail,
          reschedulingReason: BOOKING_DATA_OUTPUT_PROPERTIES.reschedulingReason,
          rescheduledByEmail: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledByEmail,
          rescheduledFromUid: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledFromUid,
          rescheduledToUid: BOOKING_DATA_OUTPUT_PROPERTIES.rescheduledToUid,
          createdAt: BOOKING_DATA_OUTPUT_PROPERTIES.createdAt,
          updatedAt: BOOKING_DATA_OUTPUT_PROPERTIES.updatedAt,
        },
      },
    },
    pagination: {
      type: 'object',
      description: 'Pagination metadata',
      properties: {
        totalItems: { type: 'number', description: 'Total number of items' },
        remainingItems: { type: 'number', description: 'Remaining items after current page' },
        returnedItems: { type: 'number', description: 'Number of items returned in this response' },
        itemsPerPage: { type: 'number', description: 'Items per page' },
        currentPage: { type: 'number', description: 'Current page number' },
        totalPages: { type: 'number', description: 'Total number of pages' },
        hasNextPage: { type: 'boolean', description: 'Whether there is a next page' },
        hasPreviousPage: { type: 'boolean', description: 'Whether there is a previous page' },
      },
    },
  },
}
