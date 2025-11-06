import type { OutlookCopyParams, OutlookCopyResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookCopyTool: ToolConfig<OutlookCopyParams, OutlookCopyResponse> = {
  id: 'outlook_copy',
  name: 'Outlook Copy',
  description: 'Copy an Outlook message to another folder',
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
      description: 'ID of the message to copy',
    },
    destinationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the destination folder',
    },
  },

  request: {
    url: '/api/tools/outlook/copy',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookCopyParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
      destinationId: params.destinationId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to copy Outlook email')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          originalMessageId: data.output.originalMessageId,
          copiedMessageId: data.output.copiedMessageId,
          destinationFolderId: data.output.destinationFolderId,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Email copy success status' },
    message: { type: 'string', description: 'Success or error message' },
    originalMessageId: { type: 'string', description: 'ID of the original message' },
    copiedMessageId: { type: 'string', description: 'ID of the copied message' },
    destinationFolderId: { type: 'string', description: 'ID of the destination folder' },
  },
}
