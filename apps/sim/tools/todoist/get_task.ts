import type { TodoistGetTaskParams, TodoistGetTaskResponse } from '@/tools/todoist/types'
import { mapTodoistTask } from '@/tools/todoist/utils'
import type { ToolConfig } from '@/tools/types'

export const todoistGetTaskTool: ToolConfig<TodoistGetTaskParams, TodoistGetTaskResponse> = {
  id: 'todoist_get_task',
  name: 'Todoist Get Task',
  description: 'Retrieve details of a single task in Todoist by its ID',
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
      description: 'The unique ID of the task to retrieve',
    },
  },

  request: {
    url: (params) => {
      if (!params.taskId) {
        throw new Error('Missing task ID for Todoist API request')
      }
      return `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(params.taskId)}`
    },
    method: 'GET',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Todoist API request')
      }
      return {
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: errorText || `Todoist API error: ${response.status} ${response.statusText}`,
        output: {
          id: '',
          content: '',
          description: '',
          projectId: '',
          priority: 1,
          url: '',
          isCompleted: false,
          createdAt: '',
          due: null,
          labels: [],
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: mapTodoistTask(data),
    }
  },

  outputs: {
    id: { type: 'string', description: 'The unique task ID' },
    content: { type: 'string', description: 'The title/content of the task' },
    description: { type: 'string', description: 'The description of the task' },
    projectId: { type: 'string', description: 'The project ID the task belongs to' },
    priority: { type: 'number', description: 'The priority of the task (1-4)' },
    url: { type: 'string', description: 'URL to view the task in Todoist' },
    isCompleted: { type: 'boolean', description: 'Whether the task is marked completed' },
    createdAt: { type: 'string', description: 'When the task was created' },
    due: {
      type: 'object',
      description: 'Due date details',
      properties: {
        date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        string: { type: 'string', description: 'Due date string representation' },
        isRecurring: { type: 'boolean', description: 'Whether the due date is recurring' },
      },
    },
    labels: {
      type: 'array',
      description: 'List of labels attached to the task',
      items: { type: 'string' },
    },
  },
}
