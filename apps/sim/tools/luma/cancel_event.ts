import type { LumaCancelEventParams, LumaCancelEventResponse } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const cancelEventTool: ToolConfig<LumaCancelEventParams, LumaCancelEventResponse> = {
  id: 'luma_cancel_event',
  name: 'Luma Cancel Event',
  description:
    'Cancel a Luma event. This is irreversible and notifies all registered guests. Requires a cancellation token obtained from the Request Event Cancellation endpoint.',
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
      description: 'Event ID to cancel (starts with evt-)',
    },
    cancellationToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Cancellation token from the Request Event Cancellation endpoint (POST /v1/event/cancel/request)',
    },
    shouldRefund: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to refund paid guests. Required if the event has paid registrations.',
    },
  },

  request: {
    url: 'https://public-api.luma.com/v1/event/cancel',
    method: 'POST',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        event_id: params.eventId.trim(),
        cancellation_token: params.cancellationToken.trim(),
      }
      if (params.shouldRefund !== undefined) body.should_refund = params.shouldRefund
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to cancel event')
    }

    return {
      success: true,
      output: {
        cancelled: true,
      },
    }
  },

  outputs: {
    cancelled: {
      type: 'boolean',
      description: 'Whether the event was successfully cancelled',
    },
  },
}
