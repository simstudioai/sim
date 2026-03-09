import type { GoogleTasksCreateParams, GoogleTasksResponse } from '@/tools/google_tasks/types'
import { TASKS_API_BASE } from '@/tools/google_tasks/types'
import type { ToolConfig } from '@/tools/types'

export const createTool: ToolConfig<GoogleTasksCreateParams, GoogleTasksResponse> = {
  id: 'google_tasks_create',
  name: 'Google Tasks Create Task',
  description: 'Create a new task in a Google Tasks list',
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
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Title of the task (max 1024 characters)',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notes/description for the task (max 8192 characters)',
    },
    due: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date in RFC 3339 format (e.g., 2025-06-03T00:00:00.000Z)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Task status: "needsAction" or "completed"',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent task ID to create this task as a subtask. Omit for top-level tasks.',
    },
    previous: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Previous sibling task ID to position after. Omit to place first among siblings.',
    },
  },

  request: {
    url: (params) => {
      const taskListId = params.taskListId || '@default'
      const queryParams = new URLSearchParams()
      if (params.parent) queryParams.set('parent', params.parent)
      if (params.previous) queryParams.set('previous', params.previous)
      const qs = queryParams.toString()
      return `${TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks${qs ? `?${qs}` : ''}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
      }
      if (params.notes) body.notes = params.notes
      if (params.due) body.due = params.due
      if (params.status) body.status = params.status
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Failed to create task')
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
