import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpTaskTagParams, ClickUpTaskTagResponse } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupRemoveTagFromTaskTool: ToolConfig<ClickUpTaskTagParams, ClickUpTaskTagResponse> =
  {
    id: 'clickup_remove_tag_from_task',
    name: 'ClickUp Remove Tag From Task',
    description: 'Remove a tag from a ClickUp task',
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
        description: 'ID of the task to remove the tag from',
      },
      tagName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Name of the tag to remove',
      },
    },

    request: {
      url: (params) =>
        `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}/tag/${encodeURIComponent(params.tagName)}`,
      method: 'DELETE',
      headers: (params) => ({
        Authorization: clickupAuthorizationHeader(params.accessToken),
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response, params) => {
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const error = extractClickUpErrorMessage(response, data, 'Failed to remove tag from task')
        return { success: false, output: { error }, error }
      }

      return {
        success: true,
        output: { taskId: params?.taskId, tagName: params?.tagName },
      }
    },

    outputs: {
      taskId: { type: 'string', description: 'ID of the task', optional: true },
      tagName: { type: 'string', description: 'Name of the tag that was removed', optional: true },
    },
  }
