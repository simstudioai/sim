import type { GmailMoveParams, GmailToolResponse } from '@/tools/gmail/types'
import type { ToolConfig } from '@/tools/types'

export const gmailMoveTool: ToolConfig<GmailMoveParams, GmailToolResponse> = {
  id: 'gmail_move',
  name: 'Gmail Move',
  description: 'Move emails between Gmail labels/folders',
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
      description: 'ID of the message to move',
    },
    addLabelIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated label IDs to add (e.g., INBOX, Label_123)',
    },
    removeLabelIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated label IDs to remove (e.g., INBOX, SPAM)',
    },
  },

  request: {
    url: '/api/tools/gmail/move',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: GmailMoveParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
      addLabelIds: params.addLabelIds,
      removeLabelIds: params.removeLabelIds,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Failed to move email',
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
