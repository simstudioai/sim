import type { LumaGetGuestParams, LumaGetGuestResponse } from '@/tools/luma/types'
import { LUMA_GUEST_OUTPUT_PROPERTIES, resolveGuestCheckedInAt } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const getGuestTool: ToolConfig<LumaGetGuestParams, LumaGetGuestResponse> = {
  id: 'luma_get_guest',
  name: 'Luma Get Guest',
  description:
    "Retrieve a single guest's details on a Luma event, including approval status, registration timestamps, and contact info.",
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
      description: 'Event ID the guest belongs to (starts with evt-)',
    },
    guestIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Guest ID (gst-...), guest key (g-...), ticket key, or the guest's email address",
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.luma.com/v1/events/guests/get')
      url.searchParams.set('event_id', params.eventId.trim())
      url.searchParams.set('id', params.guestIdentifier.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to get guest')
    }

    const guest = (data.guest as Record<string, unknown>) ?? data

    return {
      success: true,
      output: {
        guest: {
          id: (guest.id as string) ?? null,
          email: (guest.user_email as string) ?? null,
          name: (guest.user_name as string) ?? null,
          firstName: (guest.user_first_name as string) ?? null,
          lastName: (guest.user_last_name as string) ?? null,
          approvalStatus: (guest.approval_status as string) ?? null,
          registeredAt: (guest.registered_at as string) ?? null,
          invitedAt: (guest.invited_at as string) ?? null,
          joinedAt: (guest.joined_at as string) ?? null,
          checkedInAt: resolveGuestCheckedInAt(guest),
          phoneNumber: (guest.phone_number as string) ?? null,
        },
      },
    }
  },

  outputs: {
    guest: {
      type: 'object',
      description: 'Guest details',
      properties: LUMA_GUEST_OUTPUT_PROPERTIES,
    },
  },
}
