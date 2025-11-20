import type { GmailMarkReadParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailMarkReadTool: ToolConfig<GmailMarkReadParams, GmailToolResponse> = {
  id: 'gmail_mark_read',
  name: 'Gmail Mark as Read',
  description: 'Mark a Gmail message as read',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-email',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Gmail API',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to mark as read',
    },
  },

  request: {
    url: '/api/tools/gmail/mark-read',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailMarkReadParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to mark email as read',
          metadata: {},
        },
        error: data.error,
      }
    }

    return {
      success: true,
      output: {
        content: data.output.content,
        metadata: data.output.metadata,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Email metadata',
      properties: {
        id: { type: 'string', description: 'Gmail message ID' },
        threadId: { type: 'string', description: 'Gmail thread ID' },
        labelIds: { type: 'array', items: { type: 'string' }, description: 'Updated email labels' },
      },
    },
  },
}
