import type { DeleteListParams } from '@/tools/sendgrid/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const sendGridDeleteListTool: ToolConfig<DeleteListParams, ToolResponse> = {
  id: 'sendgrid_delete_list',
  name: 'SendGrid Delete List',
  description: 'Delete a contact list from SendGrid',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List ID to delete',
    },
  },

  request: {
    url: (params) => `https://api.sendgrid.com/v3/marketing/lists/${params.listId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<ToolResponse> => {
    if (!response.ok) {
      const error = (await response.json()) as { errors?: Array<{ message?: string }> }
      throw new Error(error.errors?.[0]?.message || 'Failed to delete list')
    }

    // API returns 204 No Content on success
    return {
      success: true,
      output: {
        message: 'List deleted successfully',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success message' },
  },
}
