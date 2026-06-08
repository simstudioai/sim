import type { TodoistListTasksParams, TodoistListTasksResponse } from '@/tools/todoist/types'
import { mapTodoistTask } from '@/tools/todoist/utils'
import type { ToolConfig } from '@/tools/types'

export const todoistListTasksTool: ToolConfig<TodoistListTasksParams, TodoistListTasksResponse> = {
  id: 'todoist_list_tasks',
  name: 'Todoist List Tasks',
  description:
    'List tasks with optional filters like project, label, or filter query (e.g., "today", "overdue")',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Todoist API token from settings/integrations',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by a specific project ID',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Todoist filter query string (e.g. "today", "overdue", "p1")',
    },
    label: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter tasks by a specific label name',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.todoist.com/rest/v2/tasks')
      if (params.projectId) {
        url.searchParams.append('project_id', params.projectId)
      }
      if (params.filter) {
        url.searchParams.append('filter', params.filter)
      }
      if (params.label) {
        url.searchParams.append('label', params.label)
      }
      return url.toString()
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
          tasks: [],
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        tasks: Array.isArray(data) ? data.map(mapTodoistTask) : [],
      },
    }
  },

  outputs: {
    tasks: {
      type: 'array',
      description: 'List of tasks matching the filters',
      items: {
        type: 'object',
        properties: {
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
      },
    },
  },
}
