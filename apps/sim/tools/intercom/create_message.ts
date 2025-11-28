import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildIntercomUrl, handleIntercomError } from './types'

const logger = createLogger('IntercomCreateMessage')

export interface IntercomCreateMessageParams {
  accessToken: string
  message_type: string
  subject?: string
  body: string
  from_type: string
  from_id: string
  to_type: string
  to_id: string
}

export interface IntercomCreateMessageResponse {
  success: boolean
  output: {
    message: any
    metadata: {
      operation: 'create_message'
      messageId: string
    }
    success: boolean
  }
}

export const intercomCreateMessageTool: ToolConfig<
  IntercomCreateMessageParams,
  IntercomCreateMessageResponse
> = {
  id: 'intercom_create_message',
  name: 'Create Message in Intercom',
  description: 'Create and send a new admin-initiated message in Intercom',
  version: '1.0.0',

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Intercom API access token',
    },
    message_type: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Message type: "inapp" or "email"',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The subject of the message (for email type)',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The body of the message',
    },
    from_type: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sender type: "admin"',
    },
    from_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the admin sending the message',
    },
    to_type: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Recipient type: "contact"',
    },
    to_id: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the contact receiving the message',
    },
  },

  request: {
    url: () => buildIntercomUrl('/messages'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params) => {
      const message: any = {
        message_type: params.message_type,
        body: params.body,
        from: {
          type: params.from_type,
          id: params.from_id,
        },
        to: {
          type: params.to_type,
          id: params.to_id,
        },
      }

      if (params.subject && params.message_type === 'email') {
        message.subject = params.subject
      }

      return message
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_message')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        message: data,
        metadata: {
          operation: 'create_message' as const,
          messageId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Created message data',
      properties: {
        message: { type: 'object', description: 'Created message object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
