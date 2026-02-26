import type { GoogleTasksDeleteParams, GoogleTasksDeleteResponse } from '@/tools/google_tasks/types'
import { TASKS_API_BASE } from '@/tools/google_tasks/types'
import type { ToolConfig } from '@/tools/types'

export const deleteTool: ToolConfig<GoogleTasksDeleteParams, GoogleTasksDeleteResponse> = {
  id: 'google_tasks_delete',
  name: 'Google Tasks Delete Task',
  description: 'Delete a task from a Google Tasks list',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-tasks',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Google Tasks OAuth access token',
    },
    taskListId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task list ID (defaults to primary task list "@default")',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the task to delete',
    },
  },

  request: {
    url: (params) => {
      const taskListId = params.taskListId || '@default'
      return `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(params.taskId)}`
    },
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params) => {
    if (response.status === 204 || response.ok) {
      return {
        success: true,
        output: {
          taskId: params?.taskId || '',
          deleted: true,
        },
      }
    }

    const data = await response.json()
    throw new Error(data.error?.message ?? 'Failed to delete task')
  },

  outputs: {
    taskId: { type: 'string', description: 'Deleted task ID' },
    deleted: { type: 'boolean', description: 'Whether deletion was successful' },
  },
}
