import type { GoogleTasksResponse, GoogleTasksUpdateParams } from '@/tools/google_tasks/types'
import {
  mapTaskOutput,
  TASK_EXTRA_OUTPUTS,
  TASKS_API_BASE,
  taskPath,
} from '@/tools/google_tasks/types'
import type { ToolConfig } from '@/tools/types'

export const updateTool: ToolConfig<GoogleTasksUpdateParams, GoogleTasksResponse> = {
  id: 'google_tasks_update',
  name: 'Google Tasks Update Task',
  description: 'Update an existing task in a Google Tasks list',
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
      description: 'The ID of the task to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the task',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New notes for the task',
    },
    due: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'New due date in RFC 3339 format. Google Tasks stores only the date; the time is discarded',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status: "needsAction" or "completed"',
    },
  },

  request: {
    url: (params) => `${TASKS_API_BASE}/${taskPath(params.taskListId, params.taskId)}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.title !== undefined) body.title = params.title
      if (params.notes !== undefined) body.notes = params.notes
      if (params.due !== undefined) body.due = params.due
      if (params.status !== undefined) body.status = params.status
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message ?? 'Failed to update task')
    }

    return {
      success: true,
      output: mapTaskOutput(data),
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
    ...TASK_EXTRA_OUTPUTS,
  },
}
