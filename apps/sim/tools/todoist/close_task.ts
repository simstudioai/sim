import type { TodoistCloseTaskParams, TodoistCloseTaskResponse } from '@/tools/todoist/types'
import type { ToolConfig } from '@/tools/types'

export const todoistCloseTaskTool: ToolConfig<TodoistCloseTaskParams, TodoistCloseTaskResponse> = {
  id: 'todoist_close_task',
  name: 'Todoist Close Task',
  description: 'Mark a task as complete/closed in Todoist',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Todoist API token from settings/integrations',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID of the task to close',
    },
  },

  request: {
    url: (params) => {
      if (!params.taskId) {
        throw new Error('Missing task ID for Todoist API request')
      }
      return `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(params.taskId)}/close`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Todoist API request')
      }
      return {
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: errorText || `Todoist API error: ${response.status} ${response.statusText}`,
        output: {
          success: false,
          taskId: params?.taskId || '',
        },
      }
    }

    return {
      success: true,
      output: {
        success: true,
        taskId: params?.taskId || '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the task was successfully closed' },
    taskId: { type: 'string', description: 'The ID of the closed task' },
  },
}
