import {
  countGuests,
  type LumaAddGuestsParams,
  type LumaAddGuestsResponse,
} from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const addGuestsTool: ToolConfig<LumaAddGuestsParams, LumaAddGuestsResponse> = {
  id: 'luma_add_guests',
  name: 'Luma Add Guests',
  description:
    'Add guests to a Luma event by email. Guests are added with Going (approved) status and receive one ticket of the default ticket type.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Event ID (starts with evt-)',
    },
    guests: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of guest objects. Each guest requires an "email" field and optionally "name", "first_name", "last_name". Example: [{"email": "user@example.com", "name": "John Doe"}]',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/add-guests',
    method: 'POST',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      let guestsArray: unknown[]
      try {
        guestsArray = typeof params.guests === 'string' ? JSON.parse(params.guests) : params.guests
      } catch {
        guestsArray = [{ email: params.guests }]
      }
      return {
        event_id: params.eventId.trim(),
        guests: guestsArray,
      }
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to add guests')
    }

    return {
      success: true,
      output: {
        added: countGuests(params?.guests ?? ''),
      },
    }
  },

  outputs: {
    added: {
      type: 'number',
      description: 'Number of guests submitted to the event (added with Going/approved status)',
    },
  },
}
