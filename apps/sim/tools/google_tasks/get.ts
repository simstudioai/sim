import type { GoogleTasksGetParams, GoogleTasksResponse } from '@/tools/google_tasks/types'
import { TASKS_API_BASE } from '@/tools/google_tasks/types'
import type { ToolConfig } from '@/tools/types'

export const getTool: ToolConfig<GoogleTasksGetParams, GoogleTasksResponse> = {
  id: 'google_tasks_get',
  name: 'Google Tasks Get Task',
  description: 'Retrieve a specific task by ID from a Google Tasks list',
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
      description: 'The ID of the task to retrieve',
    },
  },

  request: {
    url: (params) => {
      const taskListId = params.taskListId || '@default'
      return `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(params.taskId)}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Failed to get task')
    }

    return {
      success: true,
      output: {
        id: data.id ?? null,
        title: data.title ?? null,
        notes: data.notes ?? null,
        status: data.status ?? null,
        due: data.due ?? null,
        updated: data.updated ?? null,
        selfLink: data.selfLink ?? null,
        webViewLink: data.webViewLink ?? null,
        parent: data.parent ?? null,
        position: data.position ?? null,
        completed: data.completed ?? null,
        deleted: data.deleted ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Task ID' },
    title: { type: 'string', description: 'Task title' },
    notes: { type: 'string', description: 'Task notes', optional: true },
    status: { type: 'string', description: 'Task status (needsAction or completed)' },
    due: { type: 'string', description: 'Due date', optional: true },
    updated: { type: 'string', description: 'Last modification time' },
    selfLink: { type: 'string', description: 'URL for the task' },
    webViewLink: { type: 'string', description: 'Link to task in Google Tasks UI', optional: true },
    parent: { type: 'string', description: 'Parent task ID', optional: true },
    position: { type: 'string', description: 'Position among sibling tasks' },
    completed: { type: 'string', description: 'Completion date', optional: true },
    deleted: { type: 'boolean', description: 'Whether the task is deleted', optional: true },
  },
}
