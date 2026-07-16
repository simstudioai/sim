import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'
import type { ClickUpDeleteResponse, ClickUpDeleteTaskParams } from '@/tools/clickup/types'
import type { ToolConfig } from '@/tools/types'

export const clickupDeleteTaskTool: ToolConfig<ClickUpDeleteTaskParams, ClickUpDeleteResponse> = {
  id: 'clickup_delete_task',
  name: 'ClickUp Delete Task',
  description: 'Delete a task from ClickUp',
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
      description: 'ID of the task to delete',
    },
  },

  request: {
    url: (params) => `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(params.taskId)}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: clickupAuthorizationHeader(params.accessToken),
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const error = extractClickUpErrorMessage(response, data, 'Failed to delete task')
      return { success: false, output: { error }, error }
    }

    return {
      success: true,
      output: { id: params?.taskId, deleted: true },
    }
  },

  outputs: {
    id: { type: 'string', description: 'ID of the deleted task', optional: true },
    deleted: { type: 'boolean', description: 'Whether the task was deleted', optional: true },
  },
}
