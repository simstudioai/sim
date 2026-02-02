import type {
  CalcomUpdateEventTypeParams,
  CalcomUpdateEventTypeResponse,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const updateEventTypeTool: ToolConfig<
  CalcomUpdateEventTypeParams,
  CalcomUpdateEventTypeResponse
> = {
  id: 'calcom_update_event_type',
  name: 'Cal.com Update Event Type',
  description: 'Update an existing event type in Cal.com',
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
      description: 'Event type ID to update (e.g., 12345)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Title of the event type',
    },
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Unique slug for the event type URL',
    },
    lengthInMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Duration of the event in minutes',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Description of the event type',
    },
    slotInterval: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Interval between available booking slots in minutes',
    },
    minimumBookingNotice: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Minimum notice required before booking in minutes',
    },
    beforeEventBuffer: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Buffer time before the event in minutes',
    },
    afterEventBuffer: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Buffer time after the event in minutes',
    },
    scheduleId: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'ID of the schedule to use for availability',
    },
    disableGuests: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to disable guests from being added to bookings',
    },
  },

  request: {
    url: (params: CalcomUpdateEventTypeParams) =>
      `https://api.cal.com/v2/event-types/${params.eventTypeId}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-14',
    }),
    body: (params: CalcomUpdateEventTypeParams) => {
      const body: Record<string, unknown> = {}

      if (params.title !== undefined && params.title !== null && params.title !== '') {
        body.title = params.title
      }

      if (params.slug !== undefined && params.slug !== null && params.slug !== '') {
        body.slug = params.slug
      }

      if (
        params.description !== undefined &&
        params.description !== null &&
        params.description !== ''
      ) {
        body.description = params.description
      }

      if (
        params.lengthInMinutes !== undefined &&
        params.lengthInMinutes !== null &&
        !Number.isNaN(params.lengthInMinutes)
      ) {
        body.lengthInMinutes = params.lengthInMinutes
      }

      if (
        params.slotInterval !== undefined &&
        params.slotInterval !== null &&
        !Number.isNaN(params.slotInterval)
      ) {
        body.slotInterval = params.slotInterval
      }

      if (
        params.minimumBookingNotice !== undefined &&
        params.minimumBookingNotice !== null &&
        !Number.isNaN(params.minimumBookingNotice)
      ) {
        body.minimumBookingNotice = params.minimumBookingNotice
      }

      if (
        params.beforeEventBuffer !== undefined &&
        params.beforeEventBuffer !== null &&
        !Number.isNaN(params.beforeEventBuffer)
      ) {
        body.beforeEventBuffer = params.beforeEventBuffer
      }

      if (
        params.afterEventBuffer !== undefined &&
        params.afterEventBuffer !== null &&
        !Number.isNaN(params.afterEventBuffer)
      ) {
        body.afterEventBuffer = params.afterEventBuffer
      }

      if (
        params.scheduleId !== undefined &&
        params.scheduleId !== null &&
        !Number.isNaN(params.scheduleId)
      ) {
        body.scheduleId = params.scheduleId
      }

      if (params.disableGuests !== undefined && params.disableGuests !== null) {
        body.disableGuests = params.disableGuests
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
      description: 'Updated event type details',
      properties: {
        id: { type: 'number', description: 'Event type ID' },
        title: { type: 'string', description: 'Event type title' },
        slug: { type: 'string', description: 'Event type slug' },
        description: { type: 'string', description: 'Event type description' },
        lengthInMinutes: { type: 'number', description: 'Duration in minutes' },
        slotInterval: { type: 'number', description: 'Slot interval in minutes' },
        minimumBookingNotice: { type: 'number', description: 'Minimum booking notice in minutes' },
        beforeEventBuffer: { type: 'number', description: 'Buffer before event in minutes' },
        afterEventBuffer: { type: 'number', description: 'Buffer after event in minutes' },
        scheduleId: { type: 'number', description: 'Schedule ID' },
        disableGuests: { type: 'boolean', description: 'Whether guests are disabled' },
        createdAt: { type: 'string', description: 'ISO timestamp of creation' },
        updatedAt: { type: 'string', description: 'ISO timestamp of last update' },
      },
    },
  },
}
