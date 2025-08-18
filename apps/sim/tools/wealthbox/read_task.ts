import type { ToolConfig } from '@/tools/types'
import type { WealthboxReadParams, WealthboxReadResponse } from '@/tools/wealthbox/types'

export const wealthboxReadTaskTool: ToolConfig<WealthboxReadParams, WealthboxReadResponse> = {
  id: 'wealthbox_read_task',
  name: 'Read Wealthbox Task',
  description: 'Read content from a Wealthbox task',
  version: '1.0.0',

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
      description: 'The ID of the task to read',
      visibility: 'user-only',
    },
  },

  request: {
    url: (params) => {
      const taskId = params.taskId?.trim()
      let url = 'https://api.crmworkspace.com/v1/tasks'
      if (taskId) {
        url = `https://api.crmworkspace.com/v1/tasks/${taskId}`
      }
      return url
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

  transformResponse: async (response: Response, params?: WealthboxReadParams) => {
    const data = await response.json()

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
          operation: 'read_task' as const,
          taskId: params?.taskId || task.id?.toString() || '',
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
        task: { type: 'object', description: 'Raw task data from Wealthbox' },
        metadata: {
          type: 'object',
          description: 'Operation metadata',
          properties: {
            operation: { type: 'string', description: 'The operation performed' },
            taskId: { type: 'string', description: 'ID of the task' },
            itemType: { type: 'string', description: 'Type of item (task)' },
          },
        },
      },
    },
  },
}
