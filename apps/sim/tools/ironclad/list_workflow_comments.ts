import type {
  IroncladListWorkflowCommentsParams,
  IroncladListWorkflowCommentsResponse,
} from '@/tools/ironclad/types'
import type { ToolConfig } from '@/tools/types'

export const listWorkflowCommentsTool: ToolConfig<
  IroncladListWorkflowCommentsParams,
  IroncladListWorkflowCommentsResponse
> = {
  id: 'ironclad_list_workflow_comments',
  name: 'Ironclad List Workflow Comments',
  description: 'List all comments on a workflow.',
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
  },

  request: {
    url: (params) =>
      `https://na1.ironcladapp.com/public/api/v1/workflows/${params.ironcladWorkflowId.trim()}/comments`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to list workflow comments')
    }

    return {
      success: true,
      output: {
        comments: data.list ?? data.comments ?? data ?? [],
      },
    }
  },

  outputs: {
    comments: { type: 'json', description: 'List of comments on the workflow' },
  },
}
