import {
  CLICKUP_API_BASE_URL,
  CLICKUP_COMMENT_OUTPUT_PROPERTIES,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
  mapClickUpComment,
} from '@/tools/clickup/shared'
import type { ClickUpCommentListResponse, ClickUpGetCommentsParams } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupGetCommentsTool: ToolConfig<
  ClickUpGetCommentsParams,
  ClickUpCommentListResponse
> = {
  id: 'clickup_get_comments',
  name: 'ClickUp Get Comments',
  description:
    'Retrieve comments on a ClickUp task, newest first (25 per page; paginate with start and startId)',
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
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the task to fetch comments from',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp (ms) of the reference comment for pagination (use the date of the last comment from the previous page, together with startId)',
    },
    startId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ID of the reference comment for pagination (use the id of the last comment from the previous page, together with start)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/comment`
      )
      if (params.start !== undefined) url.searchParams.set('start', String(params.start))
      if (params.startId) url.searchParams.set('start_id', params.startId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to get comments')
      return { success: false, output: { error }, error }
    }

    const rawComments = Array.isArray(data?.comments) ? data.comments : []

    return {
      success: true,
      output: { comments: rawComments.map((comment: unknown) => mapClickUpComment(comment)) },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'Comments on the task, newest first',
      optional: true,
      items: {
        type: 'object',
        properties: CLICKUP_COMMENT_OUTPUT_PROPERTIES,
      },
    },
  },
}
