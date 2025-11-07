import type {
  LinearUpdateAttachmentParams,
  LinearUpdateAttachmentResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearUpdateAttachmentTool: ToolConfig<
  LinearUpdateAttachmentParams,
  LinearUpdateAttachmentResponse
> = {
  id: 'linear_update_attachment',
  name: 'Linear Update Attachment',
  description: 'Update an attachment metadata in Linear',
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
      description: 'Attachment ID to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New attachment title',
    },
    subtitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New attachment subtitle',
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
    body: (params) => {
      const input: Record<string, any> = {}

      if (params.title !== undefined && params.title !== null && params.title !== '')
        input.title = params.title
      if (params.subtitle !== undefined && params.subtitle !== null && params.subtitle !== '')
        input.subtitle = params.subtitle

      return {
        query: `
          mutation UpdateAttachment($id: String!, $input: AttachmentUpdateInput!) {
            attachmentUpdate(id: $id, input: $input) {
              success
              attachment {
                id
                title
                subtitle
                url
                updatedAt
              }
            }
          }
        `,
        variables: {
          id: params.attachmentId,
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to update attachment',
        output: {},
      }
    }

    const result = data.data.attachmentUpdate
    if (!result.success) {
      return {
        success: false,
        error: 'Attachment update was not successful',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        attachment: result.attachment,
      },
    }
  },

  outputs: {
    attachment: {
      type: 'object',
      description: 'The updated attachment',
      properties: {
        id: { type: 'string', description: 'Attachment ID' },
        title: { type: 'string', description: 'Attachment title' },
        subtitle: { type: 'string', description: 'Attachment subtitle' },
        url: { type: 'string', description: 'Attachment URL' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
  },
}
