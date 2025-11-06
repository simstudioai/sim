import type {
  LinearDeleteAttachmentParams,
  LinearDeleteAttachmentResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearDeleteAttachmentTool: ToolConfig<
  LinearDeleteAttachmentParams,
  LinearDeleteAttachmentResponse
> = {
  id: 'linear_delete_attachment',
  name: 'Linear Delete Attachment',
  description: 'Delete an attachment from Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Attachment ID to delete',
    },
  },

  request: {
    url: 'https://api.linear.app/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Linear API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params) => ({
      query: `
        mutation DeleteAttachment($id: String!) {
          attachmentDelete(id: $id) {
            success
          }
        }
      `,
      variables: {
        id: params.attachmentId,
      },
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete attachment',
        output: {},
      }
    }

    return {
      success: data.data.attachmentDelete.success,
      output: {
        success: data.data.attachmentDelete.success,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the delete operation was successful',
    },
  },
}
