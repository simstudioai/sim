import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { AttioDeleteCommentParams, AttioDeleteCommentResponse } from './types'

const logger = createLogger('AttioDeleteComment')

export const attioDeleteCommentTool: ToolConfig<
  AttioDeleteCommentParams,
  AttioDeleteCommentResponse
> = {
  id: 'attio_delete_comment',
  name: 'Attio Delete Comment',
  description: 'Delete a comment in Attio (if head of thread, deletes entire thread)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'attio',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'The OAuth access token for the Attio API',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The comment ID to delete',
    },
  },

  request: {
    url: (params) => `https://api.attio.com/v2/comments/${params.commentId}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      logger.error('Attio API request failed', { data, status: response.status })
      throw new Error(data.message || 'Failed to delete comment')
    }
    return {
      success: true,
      output: {
        deleted: true,
      },
    }
  },

  outputs: {
    deleted: { type: 'boolean', description: 'Whether the comment was deleted' },
  },
}
