import type { TodoistDeleteTaskParams, TodoistDeleteTaskResponse } from '@/tools/todoist/types'
import type { ToolConfig } from '@/tools/types'

export const todoistDeleteTaskTool: ToolConfig<TodoistDeleteTaskParams, TodoistDeleteTaskResponse> =
  {
    id: 'todoist_delete_task',
    name: 'Todoist Delete Task',
    description: 'Delete a task permanently in Todoist',
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
        description: 'The unique ID of the task to delete',
      },
    },

    request: {
      url: (params) => {
        if (!params.taskId) {
          throw new Error('Missing task ID for Todoist API request')
        }
        return `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(params.taskId)}`
      },
      method: 'DELETE',
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
      success: { type: 'boolean', description: 'Whether the task was successfully deleted' },
      taskId: { type: 'string', description: 'The ID of the deleted task' },
    },
  }
