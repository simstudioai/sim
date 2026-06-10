import type { LumaUpdateGuestStatusParams, LumaUpdateGuestStatusResponse } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const updateGuestStatusTool: ToolConfig<
  LumaUpdateGuestStatusParams,
  LumaUpdateGuestStatusResponse
> = {
  id: 'luma_update_guest_status',
  name: 'Luma Update Guest Status',
  description:
    "Update a guest's approval status on a Luma event — approve, decline, waitlist, or set to pending. Identify the guest by email or guest ID.",
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Event ID the guest belongs to (starts with evt-)',
    },
    guestIdentifier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Guest email address or guest ID (gst-...). Values containing '@' are treated as emails; otherwise as a guest ID.",
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New approval status: approved, declined, pending_approval, or waitlist',
    },
    shouldRefund: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Refund a paid guest when moving them out of an approved state (defaults to false)',
    },
    sendEmail: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to email the guest about the status change (defaults to true)',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/update-guest-status',
    method: 'POST',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const identifier = params.guestIdentifier.trim()
      const guest = identifier.includes('@')
        ? { type: 'email', email: identifier }
        : { type: 'api_id', api_id: identifier }
      const body: Record<string, unknown> = {
        guest,
        status: params.status,
      }
      if (params.eventId) body.event_id = params.eventId.trim()
      if (params.shouldRefund !== undefined) body.should_refund = params.shouldRefund
      if (params.sendEmail !== undefined) body.send_email = params.sendEmail
      return body
    },
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to update guest status')
    }

    return {
      success: true,
      output: {
        status: params?.status ?? '',
        guest: params?.guestIdentifier?.trim() ?? '',
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'The approval status applied to the guest',
    },
    guest: {
      type: 'string',
      description: 'The guest identifier (email or ID) that was updated',
    },
  },
}
