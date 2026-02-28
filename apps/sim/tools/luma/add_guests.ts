import type { LumaAddGuestsParams, LumaAddGuestsResponse } from '@/tools/luma/types'
import { LUMA_GUEST_OUTPUT_PROPERTIES } from '@/tools/luma/types'
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

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to add guests')
    }

    const guests = (data.entries ?? []).map((entry: Record<string, unknown>) => {
      const guest = entry.guest as Record<string, unknown>
      return {
        id: (guest.id as string) ?? null,
        email: (guest.user_email as string) ?? null,
        name: (guest.user_name as string) ?? null,
        firstName: (guest.user_first_name as string) ?? null,
        lastName: (guest.user_last_name as string) ?? null,
        approvalStatus: (guest.approval_status as string) ?? null,
        registeredAt: (guest.registered_at as string) ?? null,
        invitedAt: (guest.invited_at as string) ?? null,
        joinedAt: (guest.joined_at as string) ?? null,
        checkedInAt: (guest.checked_in_at as string) ?? null,
        phoneNumber: (guest.phone_number as string) ?? null,
      }
    })

    return {
      success: true,
      output: {
        guests,
      },
    }
  },

  outputs: {
    guests: {
      type: 'array',
      description: 'List of added guests with their assigned status and ticket info',
      items: {
        type: 'object',
        properties: LUMA_GUEST_OUTPUT_PROPERTIES,
      },
    },
  },
}
