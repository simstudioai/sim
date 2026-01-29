import type {
  CalcomCreateEventTypeParams,
  CalcomCreateEventTypeResponse,
} from '@/tools/calcom/types'
import type { ToolConfig } from '@/tools/types'

export const createEventTypeTool: ToolConfig<
  CalcomCreateEventTypeParams,
  CalcomCreateEventTypeResponse
> = {
  id: 'calcom_create_event_type',
  name: 'Cal.com Create Event Type',
  description: 'Create a new event type in Cal.com',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Title of the event type',
    },
    slug: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Unique slug for the event type URL',
    },
    lengthInMinutes: {
      type: 'number',
      required: true,
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
    url: () => 'https://api.cal.com/v2/event-types',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-06-14',
    }),
    body: (params: CalcomCreateEventTypeParams) => {
      const body: Record<string, unknown> = {
        title: params.title,
        slug: params.slug,
        lengthInMinutes: params.lengthInMinutes,
      }

      if (params.description !== undefined) {
        body.description = params.description
      }

      if (params.slotInterval !== undefined) {
        body.slotInterval = params.slotInterval
      }

      if (params.minimumBookingNotice !== undefined) {
        body.minimumBookingNotice = params.minimumBookingNotice
      }

      if (params.beforeEventBuffer !== undefined) {
        body.beforeEventBuffer = params.beforeEventBuffer
      }

      if (params.afterEventBuffer !== undefined) {
        body.afterEventBuffer = params.afterEventBuffer
      }

      if (params.scheduleId !== undefined) {
        body.scheduleId = params.scheduleId
      }

      if (params.disableGuests !== undefined) {
        body.disableGuests = params.disableGuests
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
      description: 'Created event type details',
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
