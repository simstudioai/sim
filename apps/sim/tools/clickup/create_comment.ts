import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpCreateCommentParams, ClickUpCreateCommentResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupCreateCommentTool: ToolConfig<
  ClickUpCreateCommentParams,
  ClickUpCreateCommentResponse
> = {
  id: 'clickup_create_comment',
  name: 'ClickUp Create Comment',
  description: 'Add a comment to a ClickUp task',
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
      description: 'ID of the task to comment on',
    },
    commentText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content of the comment',
    },
    assignee: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'User ID to assign the comment to',
    },
    notifyAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether to also notify the comment creator (assignees and watchers are always notified)',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/comment`,
    method: 'POST',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        comment_text: params.commentText,
        notify_all: params.notifyAll ?? false,
      }

      if (params.assignee !== undefined) body.assignee = params.assignee

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const error = extractClickUpErrorMessage(response, data, 'Failed to create comment')
      return { success: false, output: { error }, error }
    }

    const record = isRecordLike(data) ? data : {}

    return {
      success: true,
      output: {
        id: typeof record.id === 'string' ? record.id : String(record.id ?? ''),
        histId: typeof record.hist_id === 'string' ? record.hist_id : String(record.hist_id ?? ''),
        date: typeof record.date === 'number' ? record.date : Number(record.date ?? 0),
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the created comment', optional: true },
    histId: { type: 'string', description: 'History ID of the created comment', optional: true },
    date: {
      type: 'number',
      description: 'Creation timestamp of the comment (Unix ms)',
      optional: true,
    },
  },
}
