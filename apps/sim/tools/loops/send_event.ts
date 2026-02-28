import type { LoopsSendEventParams, LoopsSendEventResponse } from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsSendEventTool: ToolConfig<LoopsSendEventParams, LoopsSendEventResponse> = {
  id: 'loops_send_event',
  name: 'Loops Send Event',
  description:
    'Send an event to Loops to trigger automated email sequences for a contact. Identify the contact by email or userId and include optional event properties and mailing list changes.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The email address of the contact (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The userId of the contact (at least one of email or userId is required)',
    },
    eventName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the event to trigger',
    },
    eventProperties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event data as key-value pairs (string, number, boolean, or date values)',
    },
    mailingLists: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Mailing list IDs mapped to boolean values (true to subscribe, false to unsubscribe)',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/events/send',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to send an event')
      }

      const body: Record<string, unknown> = {
        eventName: params.eventName,
      }

      if (params.email) body.email = params.email.trim()
      if (params.userId) body.userId = params.userId.trim()

      if (params.eventProperties) {
        body.eventProperties =
          typeof params.eventProperties === 'string'
            ? JSON.parse(params.eventProperties)
            : params.eventProperties
      }

      if (params.mailingLists) {
        body.mailingLists =
          typeof params.mailingLists === 'string'
            ? JSON.parse(params.mailingLists)
            : params.mailingLists
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
        },
        error: data.message ?? 'Failed to send event',
      }
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the event was sent successfully' },
  },
}
