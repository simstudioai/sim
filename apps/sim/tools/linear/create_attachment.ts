import type {
  LinearCreateAttachmentParams,
  LinearCreateAttachmentResponse,
} from '@/tools/linear/types'
import type { ToolConfig } from '@/tools/types'

export const linearCreateAttachmentTool: ToolConfig<
  LinearCreateAttachmentParams,
  LinearCreateAttachmentResponse
> = {
  id: 'linear_create_attachment',
  name: 'Linear Create Attachment',
  description: 'Add an attachment to an issue in Linear',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'linear',
  },

  params: {
    issueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Issue ID to attach to',
    },
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the attachment',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attachment title',
    },
    subtitle: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Attachment subtitle/description',
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
      const input: Record<string, any> = {
        issueId: params.issueId,
        url: params.url,
      }

      if (params.title !== undefined && params.title !== null && params.title !== '')
        input.title = params.title
      if (params.subtitle !== undefined && params.subtitle !== null && params.subtitle !== '')
        input.subtitle = params.subtitle

      return {
        query: `
          mutation CreateAttachment($input: AttachmentCreateInput!) {
            attachmentCreate(input: $input) {
              success
              attachment {
                id
                title
                subtitle
                url
                createdAt
                updatedAt
              }
            }
          }
        `,
        variables: {
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
        error: data.errors[0]?.message || 'Failed to create attachment',
        output: {},
      }
    }

    const result = data.data.attachmentCreate
    if (!result.success) {
      return {
        success: false,
        error: 'Attachment creation was not successful',
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
      description: 'The created attachment',
      properties: {
        id: { type: 'string', description: 'Attachment ID' },
        title: { type: 'string', description: 'Attachment title' },
        subtitle: { type: 'string', description: 'Attachment subtitle' },
        url: { type: 'string', description: 'Attachment URL' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
      },
    },
  },
}
