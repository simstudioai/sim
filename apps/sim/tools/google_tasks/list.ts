import type { ToolConfig } from '@/tools/types'
import { TASKS_API_BASE } from '@/tools/google_tasks/types'
import type { GoogleTasksListParams, GoogleTasksListResponse } from '@/tools/google_tasks/types'

export const listTool: ToolConfig<GoogleTasksListParams, GoogleTasksListResponse> = {
  id: 'google_tasks_list',
  name: 'Google Tasks List Tasks',
  description: 'List all tasks in a Google Tasks list',
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
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of tasks to return (default 20, max 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination',
    },
    showCompleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to show completed tasks (default true)',
    },
    showDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to show deleted tasks (default false)',
    },
    showHidden: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to show hidden tasks (default false)',
    },
    dueMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lower bound for due date filter (RFC 3339 timestamp)',
    },
    dueMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Upper bound for due date filter (RFC 3339 timestamp)',
    },
    completedMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lower bound for task completion date (RFC 3339 timestamp)',
    },
    completedMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Upper bound for task completion date (RFC 3339 timestamp)',
    },
    updatedMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lower bound for last modification time (RFC 3339 timestamp)',
    },
  },

  request: {
    url: (params) => {
      const taskListId = params.taskListId || '@default'
      const queryParams = new URLSearchParams()
      if (params.maxResults) queryParams.set('maxResults', String(params.maxResults))
      if (params.pageToken) queryParams.set('pageToken', params.pageToken)
      if (params.showCompleted !== undefined)
        queryParams.set('showCompleted', String(params.showCompleted))
      if (params.showDeleted !== undefined)
        queryParams.set('showDeleted', String(params.showDeleted))
      if (params.showHidden !== undefined)
        queryParams.set('showHidden', String(params.showHidden))
      if (params.dueMin) queryParams.set('dueMin', params.dueMin)
      if (params.dueMax) queryParams.set('dueMax', params.dueMax)
      if (params.completedMin) queryParams.set('completedMin', params.completedMin)
      if (params.completedMax) queryParams.set('completedMax', params.completedMax)
      if (params.updatedMin) queryParams.set('updatedMin', params.updatedMin)
      const qs = queryParams.toString()
      return `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Failed to list tasks')
    }

    const items = data.items ?? []

    return {
      success: true,
      output: {
        tasks: items.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? null,
          title: (item.title as string) ?? null,
          notes: (item.notes as string) ?? null,
          status: (item.status as string) ?? null,
          due: (item.due as string) ?? null,
          updated: (item.updated as string) ?? null,
          webViewLink: (item.webViewLink as string) ?? null,
          parent: (item.parent as string) ?? null,
          position: (item.position as string) ?? null,
        })),
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    tasks: {
      type: 'json',
      description: 'Array of tasks with id, title, notes, status, due, updated, and more',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for retrieving the next page of results',
      optional: true,
    },
  },
}
