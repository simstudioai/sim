import type { ToolConfig } from '@/tools/types'
import type { WebexGetMessageParams, WebexGetMessageResponse } from '@/tools/webex/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexGetMessageTool: ToolConfig<WebexGetMessageParams, WebexGetMessageResponse> = {
  id: 'webex_get_message',
  name: 'Webex Get Message',
  description: 'Get details of a specific Webex message by its ID.',
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
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/messages/${encodeURIComponent(params.messageId)}`,
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
        output: { message: {} },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        message: {
          id: data.id,
          roomId: data.roomId,
          roomType: data.roomType,
          text: data.text,
          markdown: data.markdown,
          personId: data.personId,
          personEmail: data.personEmail,
          created: data.created,
        },
      },
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'The message object',
      properties: MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
