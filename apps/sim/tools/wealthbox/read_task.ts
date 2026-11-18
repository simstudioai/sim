import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import type { WealthboxReadParams, WealthboxReadResponse } from '@/tools/wealthbox/types'

export const wealthboxReadTaskTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_task',
  name: 'Read Wealthbox Task',
  description: 'Read content from a Wealthbox task',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'wealthbox',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      description: 'The access token for the Wealthbox API',
      visibility: 'hidden',
    },
    taskId: {
      type: 'string',
      required: false,
      description: 'The ID of the task to read (e.g., "67890")',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const taskId = params.taskId == null ? '' : String(params.taskId).trim()
      if (!taskId) return 'https://api.crmworkspace.com/v1/tasks'
      return `https://api.crmworkspace.com/v1/tasks/${safeUrlPathSegment(taskId, 'taskId')}`
    },
    method: 'GET',
    headers: (params) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (Array.isArray(data?.tasks)) {
      const tasks = data.tasks
      return {
        success: true,
        output: {
          content: `Found ${tasks.length} tasks`,
          tasks,
          metadata: {
            itemType: 'task' as const,
            totalItems: tasks.length,
          },
        },
      }
    }

    // Format task information into readable content
    const task = data
    let content = `Task: ${task.name || 'Unnamed task'}`

    if (task.due_date) {
      content += `\nDue Date: ${new Date(task.due_date).toLocaleDateString()}`
    }

    if (task.complete !== undefined) {
      content += `\nStatus: ${task.complete ? 'Complete' : 'Incomplete'}`
    }

    if (task.priority) {
      content += `\nPriority: ${task.priority}`
    }

    if (task.category) {
      content += `\nCategory: ${task.category}`
    }

    if (task.visible_to) {
      content += `\nVisible to: ${task.visible_to}`
    }

    if (task.linked_to && task.linked_to.length > 0) {
      content += '\nLinked to:'
      task.linked_to.forEach((link: any) => {
        content += `\n  - ${link.name} (${link.type})`
      })
    }

    return {
      success: true,
      output: {
        content,
        task,
        metadata: {
          itemId: task.id?.toString() ?? null,
          taskId: task.id?.toString() ?? null,
          itemType: 'task' as const,
        },
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Task data and metadata',
      properties: {
        content: { type: 'string', description: 'Formatted task information' },
        task: {
          type: 'object',
          description: 'Raw task data from Wealthbox',
          optional: true,
        },
        tasks: {
          type: 'array',
          description: 'Tasks returned when no ID is given (list request)',
          optional: true,
        },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            itemId: { type: 'string', description: 'ID of the task', optional: true },
            taskId: { type: 'string', description: 'ID of the task', optional: true },
            totalItems: {
              type: 'number',
              description: 'Number of items returned by a list request',
              optional: true,
            },
            itemType: { type: 'string', description: 'Type of item (task)' },
          },
        },
      },
    },
  },
}
