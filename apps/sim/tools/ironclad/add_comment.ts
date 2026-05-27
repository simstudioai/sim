import type { IroncladAddCommentParams, IroncladAddCommentResponse } from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const addCommentTool: ToolConfig<IroncladAddCommentParams, IroncladAddCommentResponse> = {
  id: 'ironclad_add_comment',
  name: 'Ironclad Add Comment',
  description: 'Add a comment to a workflow.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ironclad',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    ironcladWorkflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the workflow',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The comment text to add',
    },
  },

  request: {
    url: (params) =>
      `https://na1.ironcladapp.com/public/api/v1/workflows/${params.ironcladWorkflowId.trim()}/comments`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({
      comment: params.comment,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(
        (data as Record<string, string>).message ||
          (data as Record<string, string>).error ||
          'Failed to add comment'
      )
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the comment was added successfully' },
  },
}
