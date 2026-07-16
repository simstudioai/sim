import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpUpdateCommentParams, ClickUpUpdateCommentResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupUpdateCommentTool: ToolConfig<
  ClickUpUpdateCommentParams,
  ClickUpUpdateCommentResponse
> = {
  id: 'clickup_update_comment',
  name: 'ClickUp Update Comment',
  description: 'Update the content, assignee, or resolved state of a ClickUp task comment',
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
      description: 'ID of the comment to update',
    },
    commentText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New content for the comment',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign the comment to',
    },
    resolved: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the comment is resolved',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/comment/${encodeURIComponent(params.commentId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.commentText !== undefined) body.comment_text = params.commentText
      if (params.assignee !== undefined) body.assignee = params.assignee
      if (params.resolved !== undefined) body.resolved = params.resolved

      return body
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to update comment')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.commentId, updated: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the updated comment', optional: true },
    updated: { type: 'boolean', description: 'Whether the comment was updated', optional: true },
  },
}
