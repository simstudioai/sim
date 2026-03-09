import type { OutlookMoveParams, OutlookMoveResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookMoveTool: ToolConfig<OutlookMoveParams, OutlookMoveResponse> = {
  id: 'outlook_move',
  name: 'Outlook Move',
  description: 'Move emails between Outlook folders',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Outlook API',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to move',
    },
    destinationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the destination folder',
    },
  },

  request: {
    url: '/api/tools/outlook/move',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookMoveParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
      destinationId: params.destinationId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to move Outlook email')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          messageId: data.output.messageId,
          newFolderId: data.output.newFolderId,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Email move success status' },
    message: { type: 'string', description: 'Success or error message' },
    messageId: { type: 'string', description: 'ID of the moved message' },
    newFolderId: { type: 'string', description: 'ID of the destination folder' },
  },
}
