import type { TodoistUpdateTaskParams, TodoistUpdateTaskResponse } from '@/tools/todoist/types'
import { mapTodoistTask } from '@/tools/todoist/utils'
import type { ToolConfig } from '@/tools/types'

export const todoistUpdateTaskTool: ToolConfig<TodoistUpdateTaskParams, TodoistUpdateTaskResponse> =
  {
    id: 'todoist_update_task',
    name: 'Todoist Update Task',
    description: 'Update an existing task in Todoist by its ID',
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
        description: 'The unique ID of the task to update',
      },
      content: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The new title or text content of the task',
      },
      description: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'The new description for the task',
      },
      priority: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'New task priority from 1 (normal) to 4 (urgent)',
      },
      dueString: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'New human-defined due date (e.g. "tomorrow", "next Monday", "Friday at 2pm")',
      },
      labels: {
        type: 'array',
        required: false,
        visibility: 'user-or-llm',
        description: 'New list of label names to apply to the task',
        items: { type: 'string' },
      },
    },

    request: {
      url: (params) => {
        if (!params.taskId) {
          throw new Error('Missing task ID for Todoist API request')
        }
        return `https://api.todoist.com/rest/v2/tasks/${encodeURIComponent(params.taskId)}`
      },
      method: 'POST',
      headers: (params) => {
        if (!params.apiKey) {
          throw new Error('Missing API key for Todoist API request')
        }
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        }
      },
      body: (params) => {
        const body: Record<string, any> = {}
        if (params.content !== undefined) body.content = params.content
        if (params.description !== undefined) body.description = params.description
        if (params.priority !== undefined) body.priority = params.priority
        if (params.dueString !== undefined) body.due_string = params.dueString
        if (params.labels !== undefined) body.labels = params.labels
        return body
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
