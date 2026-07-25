import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpDeleteCommentParams, ClickUpDeleteResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupDeleteCommentTool: ToolConfig<
  ClickUpDeleteCommentParams,
  ClickUpDeleteResponse
> = {
  id: 'clickup_delete_comment',
  name: 'ClickUp Delete Comment',
  description: 'Delete a comment from a ClickUp task',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'clickup',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token or personal API token for ClickUp',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the comment to delete',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/comment/${encodeURIComponent(params.commentId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to delete comment')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.commentId, deleted: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted comment', optional: true },
    deleted: { type: 'boolean', description: 'Whether the comment was deleted', optional: true },
  },
}
