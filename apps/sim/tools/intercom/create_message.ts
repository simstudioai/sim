import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

export interface IntercomCreateMessageParams {
  accessToken: string
  message_type: 'inapp' | 'email'
  template: 'plain' | 'personal'
  subject?: string
  body: string
  from_type: string
  from_id: string
  to_type: string
  to_id: string
  created_at?: number
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

export interface IntercomCreateMessageV2Response {
  success: boolean
  output: {
    message: any
    messageId: string
    success: boolean
  }
}

const createMessageBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    message_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message type: "inapp" for in-app messages or "email" for email messages',
    },
    template: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Message template style: "plain" for plain text or "personal" for personalized style',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The subject of the message (for email type)',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The body of the message',
    },
    from_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sender type: "admin"',
    },
    from_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the admin sending the message',
    },
    to_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient type: "contact"',
    },
    to_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the contact receiving the message',
    },
    created_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp for when the message was created. If not provided, current time is used.',
    },
  },
  request: {
    url: () => buildIntercomUrl('/messages'),
    method: 'POST',
    headers: (params: IntercomCreateMessageParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateMessageParams) => {
      // Map "inapp" to "in_app" as required by Intercom API
      const apiMessageType = params.message_type === 'inapp' ? 'in_app' : params.message_type

      const message: any = {
        message_type: apiMessageType,
        template: params.template,
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

      if (params.created_at) message.created_at = params.created_at

      return message
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateMessageParams, any>, 'params' | 'request'>

export const intercomCreateMessageTool: ToolConfig<
  IntercomCreateMessageParams,
  IntercomCreateMessageResponse
> = {
  id: 'intercom_create_message',
  name: 'Create Message in Intercom',
  description: 'Create and send a new admin-initiated message in Intercom',
  version: '1.0.0',

  ...createMessageBase,

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
    message: {
      type: 'object',
      description: 'Created message object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the message' },
        type: { type: 'string', description: 'Object type (message)' },
        created_at: { type: 'number', description: 'Unix timestamp when message was created' },
        body: { type: 'string', description: 'Body of the message' },
        message_type: { type: 'string', description: 'Type of the message (in_app or email)' },
        conversation_id: { type: 'string', description: 'ID of the conversation created' },
        owner: { type: 'object', description: 'Owner of the message' },
      },
    },
    metadata: {
      type: 'object',
      description: 'Operation metadata',
      properties: {
        operation: { type: 'string', description: 'The operation performed (create_message)' },
        messageId: { type: 'string', description: 'ID of the created message' },
      },
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}

export const intercomCreateMessageV2Tool: ToolConfig<
  IntercomCreateMessageParams,
  IntercomCreateMessageV2Response
> = {
  ...createMessageBase,
  id: 'intercom_create_message_v2',
  name: 'Create Message in Intercom',
  description:
    'Create and send a new admin-initiated message in Intercom. Returns API-aligned fields only.',
  version: '2.0.0',

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
        messageId: data.id,
        success: true,
      },
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'Created message object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the message' },
        type: { type: 'string', description: 'Object type (message)' },
        created_at: { type: 'number', description: 'Unix timestamp when message was created' },
        body: { type: 'string', description: 'Body of the message' },
        message_type: { type: 'string', description: 'Type of the message (in_app or email)' },
        conversation_id: { type: 'string', description: 'ID of the conversation created' },
        owner: { type: 'object', description: 'Owner of the message' },
      },
    },
    messageId: { type: 'string', description: 'ID of the created message' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
