import { isRecordLike } from '@sim/utils/object'
import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type {
  ClickUpCreateCommentParams,
  ClickUpCreateCommentResponse,
} from '@/tools/clickup/types'
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
        'When true, comment notifications are sent to everyone, including the comment creator',
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
    const id = record.id
    const histId = record.hist_id
    const rawDate = record.date
    const date =
      typeof rawDate === 'number'
        ? rawDate
        : typeof rawDate === 'string' && Number.isFinite(Number(rawDate))
          ? Number(rawDate)
          : undefined

    return {
      success: true,
      output: {
        id: id === undefined || id === null ? undefined : String(id),
        histId: histId === undefined || histId === null ? undefined : String(histId),
        date,
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
