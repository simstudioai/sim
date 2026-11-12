import type { ToolConfig } from '@/tools/types'
import type { WebexSendMessageParams, WebexSendMessageResponse } from '@/tools/webex/types'
import { MESSAGE_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexSendMessageTool: ToolConfig<WebexSendMessageParams, WebexSendMessageResponse> = {
  id: 'webex_send_message',
  name: 'Webex Send Message',
  description:
    'Send a message to a Webex room or as a direct message to a person. Supports plain text and Markdown.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['spark:messages_write'],
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Room ID to send the message to (e.g., Y2lzY29zcGFyazovL3Vz...)',
    },
    toPersonId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID for direct messages',
    },
    toPersonEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address for direct messages (e.g., user@example.com)',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text message content',
    },
    markdown: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Markdown-formatted message content',
    },
  },

  request: {
    url: 'https://webexapis.com/v1/messages',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.roomId) body.roomId = params.roomId
      if (params.toPersonId) body.toPersonId = params.toPersonId
      if (params.toPersonEmail) body.toPersonEmail = params.toPersonEmail
      if (params.text) body.text = params.text
      if (params.markdown) body.markdown = params.markdown
      return body
    },
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
      description: 'The sent message object',
      properties: MESSAGE_OUTPUT_PROPERTIES,
    },
  },
}
