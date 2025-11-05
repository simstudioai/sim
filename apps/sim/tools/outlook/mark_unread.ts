import type { OutlookMarkReadParams, OutlookMarkReadResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookMarkUnreadTool: ToolConfig<OutlookMarkReadParams, OutlookMarkReadResponse> = {
  id: 'outlook_mark_unread',
  name: 'Outlook Mark as Unread',
  description: 'Mark an Outlook message as unread',
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
      description: 'ID of the message to mark as unread',
    },
  },

  request: {
    url: '/api/tools/outlook/mark-unread',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookMarkReadParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to mark Outlook email as unread')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          messageId: data.output.messageId,
          isRead: data.output.isRead,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Success or error message' },
    messageId: { type: 'string', description: 'ID of the message' },
    isRead: { type: 'boolean', description: 'Read status of the message' },
  },
}
