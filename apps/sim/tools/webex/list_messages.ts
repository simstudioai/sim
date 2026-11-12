import type { ToolConfig } from '@/tools/types'
import type { WebexListMessagesParams, WebexListMessagesResponse } from '@/tools/webex/types'
import { MESSAGES_LIST_OUTPUT } from '@/tools/webex/types'

export const webexListMessagesTool: ToolConfig<WebexListMessagesParams, WebexListMessagesResponse> =
  {
    id: 'webex_list_messages',
    name: 'Webex List Messages',
    description: 'List messages in a Webex room, from newest to oldest.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'webex',
      requiredScopes: ['spark:messages_read'],
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for Webex API',
      },
      roomId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Room ID to list messages from',
      },
      max: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of messages to return (1-1000, default 50)',
      },
      before: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'ISO 8601 date – list messages sent before this date',
      },
      beforeMessage: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Message ID – list messages sent before this message',
      },
    },

    request: {
      url: (params) => {
        const base = 'https://webexapis.com/v1/messages'
        const query = new URLSearchParams({ roomId: params.roomId })
        if (params.max) query.set('max', String(params.max))
        if (params.before) query.set('before', params.before)
        if (params.beforeMessage) query.set('beforeMessage', params.beforeMessage)
        return `${base}?${query.toString()}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error:
            (errorData as { message?: string }).message ||
            `Webex API error: ${response.status} ${response.statusText}`,
          output: { messages: [] },
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: { messages: data.items ?? [] },
      }
    },

    outputs: {
      messages: MESSAGES_LIST_OUTPUT,
    },
  }
