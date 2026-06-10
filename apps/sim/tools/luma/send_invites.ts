import {
  countGuests,
  type LumaSendInvitesParams,
  type LumaSendInvitesResponse,
} from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const sendInvitesTool: ToolConfig<LumaSendInvitesParams, LumaSendInvitesResponse> = {
  id: 'luma_send_invites',
  name: 'Luma Send Invites',
  description:
    'Send email invitations to guests for a Luma event. Unlike Add Guests (which registers guests directly), this emails an invite that recipients can accept.',
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
      description: 'Event ID to invite guests to (starts with evt-)',
    },
    guests: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of guest objects. Each guest requires an "email" field and optionally "name". Example: [{"email": "user@example.com", "name": "John Doe"}]',
    },
    message: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional custom message included in the invite email (max 200 characters)',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/send-invites',
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
      const body: Record<string, unknown> = {
        event_id: params.eventId.trim(),
        guests: guestsArray,
      }
      if (params.message) body.message = params.message
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to send invites')
    }

    return {
      success: true,
      output: {
        invited: countGuests(params?.guests ?? ''),
      },
    }
  },

  outputs: {
    invited: {
      type: 'number',
      description: 'Number of guests invited to the event',
    },
  },
}
