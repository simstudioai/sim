import type { OutlookDeleteParams, OutlookDeleteResponse } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

export const outlookDeleteTool: ToolConfig<OutlookDeleteParams, OutlookDeleteResponse> = {
  id: 'outlook_delete',
  name: 'Outlook Delete',
  description: 'Delete an Outlook message (move to Deleted Items)',
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
      description: 'ID of the message to delete',
    },
  },

  request: {
    url: '/api/tools/outlook/delete',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: OutlookDeleteParams) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to delete Outlook email')
    }
    return {
      success: true,
      output: {
        message: data.output.message,
        results: {
          messageId: data.output.messageId,
          status: data.output.status,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Success or error message' },
    messageId: { type: 'string', description: 'ID of the deleted message' },
    status: { type: 'string', description: 'Deletion status' },
  },
}
